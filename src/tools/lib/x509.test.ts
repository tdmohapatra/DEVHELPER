import { describe, expect, it } from "vitest";
import {
  analyseChain,
  certificateFindings,
  CertificateError,
  daysUntil,
  decodeOid,
  decodeTime,
  DAY_MS,
  fingerprint,
  matchesHostname,
  mtlsReadiness,
  parseCertificate,
  parseDer,
  pemBlocks,
  readCertificates,
  toHex,
} from "./x509";

// ---------------------------------------------------------------------------
// A minimal DER encoder, so every fixture has exactly known contents.
// Building the certificates rather than embedding a real one means each
// assertion is against a field this file chose.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => new Uint8Array(values);

function encodeLength(length: number): number[] {
  if (length < 0x80) return [length];
  const out: number[] = [];
  let n = length;
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  return new Uint8Array([tag, ...encodeLength(content.length), ...content]);
}

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));
const int = (...values: number[]) => tlv(0x02, bytes(...values));
const boolTrue = () => tlv(0x01, bytes(0xff));
const nullValue = () => tlv(0x05, new Uint8Array());
const octet = (content: Uint8Array) => tlv(0x04, content);
const bitString = (content: Uint8Array, unused = 0) => tlv(0x03, concat(bytes(unused), content));
const utf8 = (text: string) => tlv(0x0c, new TextEncoder().encode(text));
const utcTime = (text: string) => tlv(0x17, new TextEncoder().encode(text));
const generalizedTime = (text: string) => tlv(0x18, new TextEncoder().encode(text));
const ctx = (n: number, content: Uint8Array, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, content);

function oid(dotted: string): Uint8Array {
  const parts = dotted.split(".").map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, bytes(...out));
}

const rdn = (attributeOid: string, value: string) => set(seq(oid(attributeOid), utf8(value)));
const name = (cn: string, o?: string) => (o ? seq(rdn("2.5.4.10", o), rdn("2.5.4.3", cn)) : seq(rdn("2.5.4.3", cn)));

/** An RSA SubjectPublicKeyInfo of the requested modulus size. */
function rsaKey(bits: number): Uint8Array {
  // A leading zero byte is the sign bit of a positive INTEGER, not key material.
  const modulus = new Uint8Array(bits / 8 + 1);
  modulus[1] = 0x80;
  return seq(seq(oid("1.2.840.113549.1.1.1"), nullValue()), bitString(seq(tlv(0x02, modulus), int(0x01, 0x00, 0x01))));
}

interface CertOptions {
  cn: string;
  issuerCn?: string;
  org?: string;
  notBefore?: string;
  notAfter?: string;
  sans?: string[];
  isCa?: boolean;
  eku?: string[];
  keyUsage?: number[];
  sigOid?: string;
  keyBits?: number;
  serial?: number[];
  generalized?: boolean;
}

function buildCertificate(options: CertOptions): Uint8Array {
  const {
    cn,
    issuerCn = cn,
    org,
    notBefore = "250101000000Z",
    notAfter = "300101000000Z",
    sans = [],
    isCa = false,
    eku = [],
    keyUsage,
    sigOid = "1.2.840.113549.1.1.11",
    keyBits = 2048,
    serial = [0x01, 0x02, 0x03],
    generalized = false,
  } = options;

  const time = generalized ? generalizedTime : utcTime;
  const extensions: Uint8Array[] = [];

  if (sans.length > 0) {
    const entries = sans.map((value) =>
      /^\d+\.\d+\.\d+\.\d+$/.test(value)
        ? tlv(0x87, bytes(...value.split(".").map(Number)))
        : tlv(0x82, new TextEncoder().encode(value)),
    );
    extensions.push(seq(oid("2.5.29.17"), octet(seq(...entries))));
  }
  if (isCa) {
    extensions.push(seq(oid("2.5.29.19"), boolTrue(), octet(seq(boolTrue()))));
  }
  if (eku.length > 0) {
    extensions.push(seq(oid("2.5.29.37"), octet(seq(...eku.map(oid)))));
  }
  if (keyUsage) {
    // Bit 0 is the most significant bit of the first content byte, and the
    // unused-bit count is whatever follows the last bit that is set.
    let byte = 0;
    for (const bit of keyUsage) byte |= 0x80 >> bit;
    const unused = 7 - Math.max(...keyUsage);
    extensions.push(seq(oid("2.5.29.15"), boolTrue(), octet(bitString(bytes(byte), unused))));
  }

  const tbs = seq(
    ctx(0, int(0x02)),
    tlv(0x02, bytes(...serial)),
    seq(oid(sigOid), nullValue()),
    name(issuerCn),
    seq(time(notBefore), time(notAfter)),
    name(cn, org),
    rsaKey(keyBits),
    ...(extensions.length > 0 ? [ctx(3, seq(...extensions))] : []),
  );

  return seq(tbs, seq(oid(sigOid), nullValue()), bitString(bytes(0xde, 0xad)));
}

function toPem(der: Uint8Array): string {
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  return `-----BEGIN CERTIFICATE-----\n${btoa(binary).replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`;
}

// ---------------------------------------------------------------------------

describe("parseDer", () => {
  it("reads tag, length and value", () => {
    const node = parseDer(seq(int(0x2a)));
    expect(node.tagNumber).toBe(0x10);
    expect(node.constructed).toBe(true);
    expect(node.children[0].value).toEqual(bytes(0x2a));
  });

  it("reads a multi-byte length", () => {
    const content = new Uint8Array(300).fill(0x41);
    const node = parseDer(tlv(0x04, content));
    expect(node.value.length).toBe(300);
  });

  it("says where a truncated value ran out rather than throwing something opaque", () => {
    expect(() => parseDer(bytes(0x04, 0x05, 0x01, 0x02))).toThrow(CertificateError);
    expect(() => parseDer(bytes(0x04, 0x05, 0x01, 0x02))).toThrow(/claims 5 bytes/);
  });

  it("refuses indefinite length, which is BER and not DER", () => {
    expect(() => parseDer(bytes(0x30, 0x80, 0x00, 0x00))).toThrow(/Indefinite length/);
  });
});

describe("decodeOid and decodeTime", () => {
  it("unpacks the two arcs in the first byte", () => {
    expect(decodeOid(oid("1.2.840.113549.1.1.11").subarray(2))).toBe("1.2.840.113549.1.1.11");
    expect(decodeOid(oid("2.5.29.17").subarray(2))).toBe("2.5.29.17");
    expect(decodeOid(new Uint8Array())).toBe("");
  });

  it("applies the UTCTime pivot at 50 rather than assuming 20xx", () => {
    expect(decodeTime(parseDer(utcTime("491231235959Z")))!.getUTCFullYear()).toBe(2049);
    expect(decodeTime(parseDer(utcTime("500101000000Z")))!.getUTCFullYear()).toBe(1950);
  });

  it("reads a four-digit GeneralizedTime", () => {
    expect(decodeTime(parseDer(generalizedTime("20301231235959Z")))!.toISOString()).toBe("2030-12-31T23:59:59.000Z");
  });

  it("returns null for a time it cannot read", () => {
    expect(decodeTime(parseDer(utcTime("nonsense")))).toBeNull();
  });
});

describe("readCertificates", () => {
  const der = buildCertificate({ cn: "example.com" });

  it("reads a PEM block", () => {
    expect(readCertificates(toPem(der))).toHaveLength(1);
  });

  it("reads several, which is what a chain file is", () => {
    const chain = `${toPem(der)}\n${toPem(buildCertificate({ cn: "Issuing CA", isCa: true }))}`;
    expect(readCertificates(chain)).toHaveLength(2);
    expect(pemBlocks(chain).map((b) => b.label)).toEqual(["CERTIFICATE", "CERTIFICATE"]);
  });

  it("accepts bare base64, which is how it arrives out of a secret", () => {
    const body = toPem(der).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(readCertificates(body)).toHaveLength(1);
  });

  it("says what it found when it is not a certificate", () => {
    expect(() => readCertificates("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")).toThrow(/not a certificate/);
    expect(() => readCertificates("hello there!")).toThrow(/neither PEM nor base64/);
    // Valid base64 that is not DER — caught by the leading SEQUENCE check.
    expect(() => readCertificates(btoa("not a certificate"))).toThrow(/does not start with a DER SEQUENCE/);
    expect(() => readCertificates("")).toThrow(/Nothing to read/);
  });
});

describe("parseCertificate", () => {
  const cert = parseCertificate(
    buildCertificate({
      cn: "api.example.com",
      org: "Example Ltd",
      issuerCn: "Example Issuing CA",
      sans: ["api.example.com", "www.example.com", "10.0.0.1"],
      eku: ["1.3.6.1.5.5.7.3.1", "1.3.6.1.5.5.7.3.2"],
      keyUsage: [0, 2],
      serial: [0x0a, 0xbb],
    }),
  );

  it("reads the identity fields", () => {
    expect(cert.version).toBe(3);
    expect(cert.serial).toBe("0a:bb");
    expect(cert.subject.parts.CN).toBe("api.example.com");
    expect(cert.subject.parts.O).toBe("Example Ltd");
    expect(cert.issuer.parts.CN).toBe("Example Issuing CA");
    expect(cert.selfSigned).toBe(false);
  });

  it("shows the name most specific first, the way every tool prints it", () => {
    expect(cert.subject.text).toBe("CN=api.example.com, O=Example Ltd");
  });

  it("reads the algorithm and key size, allowing for the INTEGER sign byte", () => {
    expect(cert.signatureAlgorithm).toBe("SHA-256 with RSA");
    expect(cert.keyAlgorithm).toBe("RSA");
    expect(cert.keyBits).toBe(2048);
  });

  it("reads DNS and IP alternative names", () => {
    expect(cert.altNames).toEqual(["api.example.com", "www.example.com", "10.0.0.1"]);
  });

  it("reads key usage bits and extended key usage", () => {
    expect(cert.keyUsage).toEqual(["digitalSignature", "keyEncipherment"]);
    expect(cert.extendedKeyUsage).toEqual(["serverAuth", "clientAuth"]);
  });

  it("reads basicConstraints", () => {
    expect(cert.isCa).toBe(false);
    expect(parseCertificate(buildCertificate({ cn: "CA", isCa: true })).isCa).toBe(true);
  });

  it("notices a self-signed certificate", () => {
    expect(parseCertificate(buildCertificate({ cn: "self" })).selfSigned).toBe(true);
  });

  it("computes the SHA-256 fingerprint a pinning config uses", async () => {
    const print = await fingerprint(cert.der);
    expect(print).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/);
    expect(await fingerprint(cert.der)).toBe(print);
  });

  it("refuses something that is not a certificate at all", () => {
    expect(() => parseCertificate(bytes(0x30, 0x03, 0x02, 0x01, 0x01))).toThrow(/SEQUENCE of three things/);
  });
});

describe("certificateFindings", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const messages = (findings: { message: string }[]) => findings.map((f) => f.message).join(" | ");

  it("is quiet about a healthy certificate", () => {
    const cert = parseCertificate(buildCertificate({ cn: "ok.example.com", issuerCn: "CA", sans: ["ok.example.com"], notAfter: "251201000000Z" }));
    expect(certificateFindings(cert, at("2025-06-01T00:00:00Z"))).toEqual([]);
  });

  it("leads with expiry, and counts the days", () => {
    const cert = parseCertificate(buildCertificate({ cn: "old.example.com", issuerCn: "CA", sans: ["x"], notAfter: "250101000000Z" }));
    const finding = certificateFindings(cert, at("2025-01-11T00:00:00Z"))[0];
    expect(finding.level).toBe("error");
    expect(finding.message).toMatch(/Expired 10 day\(s\) ago/);
  });

  it("escalates as expiry approaches", () => {
    const cert = parseCertificate(buildCertificate({ cn: "soon.example.com", issuerCn: "CA", sans: ["x"], notAfter: "250201000000Z" }));
    expect(certificateFindings(cert, at("2025-01-25T00:00:00Z"))[0].level).toBe("error");
    const warn = certificateFindings(cert, at("2025-01-05T00:00:00Z"))[0];
    expect(warn.level).toBe("warn");
    expect(warn.message).toMatch(/change window/);
  });

  it("explains a not-yet-valid certificate as a clock problem", () => {
    const cert = parseCertificate(buildCertificate({ cn: "future.example.com", issuerCn: "CA", sans: ["x"], notBefore: "260101000000Z", notAfter: "270101000000Z" }));
    expect(messages(certificateFindings(cert, at("2025-06-01T00:00:00Z")))).toMatch(/clock skew/);
  });

  it("calls a missing SAN an error, because the CN is ignored now", () => {
    const cert = parseCertificate(buildCertificate({ cn: "nosan.example.com", issuerCn: "CA" }));
    expect(messages(certificateFindings(cert, at("2025-06-01T00:00:00Z")))).toMatch(/ignores the CN/);
  });

  it("rejects SHA-1 and short keys", () => {
    const sha1 = parseCertificate(buildCertificate({ cn: "a", issuerCn: "CA", sans: ["a"], sigOid: "1.2.840.113549.1.1.5" }));
    expect(messages(certificateFindings(sha1, at("2025-06-01T00:00:00Z")))).toMatch(/SHA-1 signatures are rejected/);

    const weak = parseCertificate(buildCertificate({ cn: "a", issuerCn: "CA", sans: ["a"], keyBits: 1024 }));
    expect(messages(certificateFindings(weak, at("2025-06-01T00:00:00Z")))).toMatch(/1024-bit RSA/);
  });

  it("flags a leaf valid for longer than public clients accept", () => {
    const long = parseCertificate(buildCertificate({ cn: "a", issuerCn: "CA", sans: ["a"], notBefore: "250101000000Z", notAfter: "280101000000Z" }));
    expect(messages(certificateFindings(long, at("2025-06-01T00:00:00Z")))).toMatch(/398 days/);
  });

  it("counts whole days, negative once past", () => {
    expect(daysUntil(new Date(at("2025-01-11T00:00:00Z")), at("2025-01-01T00:00:00Z"))).toBe(10);
    expect(daysUntil(new Date(at("2025-01-01T00:00:00Z")), at("2025-01-11T00:00:00Z"))).toBe(-10);
    expect(daysUntil(null)).toBeNull();
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe("mtlsReadiness", () => {
  it("warns when a client certificate cannot be a client certificate", () => {
    const cert = parseCertificate(buildCertificate({ cn: "client", issuerCn: "CA", sans: ["client"], eku: ["1.3.6.1.5.5.7.3.1"] }));
    expect(mtlsReadiness(cert)[0].message).toMatch(/No clientAuth/);
    expect(mtlsReadiness(cert)[0].message).toMatch(/handshake failure/);
  });

  it("says an unrestricted certificate is unrestricted", () => {
    const cert = parseCertificate(buildCertificate({ cn: "either", issuerCn: "CA", sans: ["either"] }));
    expect(mtlsReadiness(cert)[0].message).toMatch(/unrestricted/);
  });

  it("is content with both usages present", () => {
    const cert = parseCertificate(
      buildCertificate({ cn: "both", issuerCn: "CA", sans: ["both"], eku: ["1.3.6.1.5.5.7.3.1", "1.3.6.1.5.5.7.3.2"] }),
    );
    expect(mtlsReadiness(cert)).toEqual([]);
  });
});

describe("analyseChain", () => {
  const leaf = parseCertificate(buildCertificate({ cn: "api.example.com", issuerCn: "Issuing CA", sans: ["api.example.com"] }));
  const intermediate = parseCertificate(buildCertificate({ cn: "Issuing CA", issuerCn: "Root CA", isCa: true }));
  const root = parseCertificate(buildCertificate({ cn: "Root CA", issuerCn: "Root CA", isCa: true }));

  it("orders leaf, intermediate, root and is happy", () => {
    const report = analyseChain([leaf, intermediate, root]);
    expect(report.ordered.map((c) => c.subject.parts.CN)).toEqual(["api.example.com", "Issuing CA", "Root CA"]);
    expect(report.findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("names the missing intermediate, and why it works in a browser", () => {
    const report = analyseChain([leaf, root]);
    const error = report.findings.find((f) => f.level === "error");
    expect(error?.message).toMatch(/"CN=Issuing CA" is not in this file/);
    expect(error?.message).toMatch(/works in my browser, fails from curl/);
  });

  it("reports a chain that does not start with the leaf", () => {
    const report = analyseChain([intermediate, leaf, root]);
    expect(report.findings.some((f) => /first certificate in the file is not the leaf/.test(f.message))).toBe(true);
  });

  it("notes the root is pointless rather than wrong", () => {
    const report = analyseChain([leaf, intermediate, root]);
    expect(report.findings.some((f) => f.level === "info" && /will not start trusting it/.test(f.message))).toBe(true);
  });

  it("reports an expired intermediate, which a valid leaf does not save", () => {
    const stale = parseCertificate(buildCertificate({ cn: "Issuing CA", issuerCn: "Root CA", isCa: true, notAfter: "250101000000Z" }));
    const report = analyseChain([leaf, stale, root], new Date("2025-06-01T00:00:00Z").getTime());
    expect(report.findings.some((f) => /intermediate in the chain expired/.test(f.message))).toBe(true);
  });

  it("reports certificates in the file that are not on the path", () => {
    const stray = parseCertificate(buildCertificate({ cn: "Unrelated CA", issuerCn: "Unrelated CA", isCa: true }));
    const report = analyseChain([leaf, intermediate, stray]);
    expect(report.findings.some((f) => /being sent for nothing/.test(f.message))).toBe(true);
  });

  it("handles an empty file", () => {
    expect(analyseChain([]).ordered).toEqual([]);
  });
});

describe("matchesHostname", () => {
  const wildcard = parseCertificate(buildCertificate({ cn: "*.example.com", issuerCn: "CA", sans: ["*.example.com", "example.com"] }));

  it("matches an exact name", () => {
    expect(matchesHostname(wildcard, "example.com").matched).toBe(true);
  });

  it("matches one label under a wildcard, and no more", () => {
    expect(matchesHostname(wildcard, "api.example.com")).toMatchObject({ matched: true, by: "*.example.com" });
    expect(matchesHostname(wildcard, "a.b.example.com").matched).toBe(false);
  });

  it("does not let a wildcard match the bare domain by itself", () => {
    const only = parseCertificate(buildCertificate({ cn: "*.example.com", issuerCn: "CA", sans: ["*.example.com"] }));
    expect(matchesHostname(only, "example.com").matched).toBe(false);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(matchesHostname(wildcard, "API.Example.com.").matched).toBe(true);
    expect(matchesHostname(wildcard, "  ").matched).toBe(false);
  });
});

describe("toHex", () => {
  it("prints bytes the way openssl does", () => {
    expect(toHex(bytes(0x0a, 0xbb, 0x00))).toBe("0a:bb:00");
    expect(toHex(bytes(1, 2), "")).toBe("0102");
  });
});
