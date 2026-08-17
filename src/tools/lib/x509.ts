/**
 * Reading an X.509 certificate, without a library and without a server.
 *
 * The certificate incident is always the same: something expired, or a chain is
 * missing its intermediate, or a client certificate turns out not to carry
 * `clientAuth` — and the error at the other end says `handshake failure`, which
 * names none of those. Everything needed to tell them apart is *inside the
 * certificate*, so it can be read from a paste with no network at all.
 *
 * This parses DER by hand. A certificate is nested TLV — tag, length, value —
 * and the parts that matter are shallow: the validity dates, the subject and
 * issuer names, and three or four extensions. Doing it directly avoids a
 * dependency and, more usefully, means the parser can say *where* a malformed
 * certificate went wrong instead of throwing from inside somebody's library.
 *
 * What it does not do is verify anything cryptographically. It reads what the
 * certificate claims. Signature verification needs the issuer's public key and a
 * trust store, and a tool that implied it had checked a signature when it had
 * not would be worse than one that says plainly that it did not.
 */

// ---------------------------------------------------------------------------
// DER
// ---------------------------------------------------------------------------

export class CertificateError extends Error {}

export interface Asn1Node {
  /** Raw tag byte. */
  tag: number;
  /** Tag number without class and constructed bits. */
  tagNumber: number;
  constructed: boolean;
  /** Class: 0 universal, 1 application, 2 context-specific, 3 private. */
  cls: number;
  /** Value bytes, excluding tag and length. */
  value: Uint8Array;
  children: Asn1Node[];
  /** Offset of the tag byte in the buffer it was read from. */
  start: number;
  /** Offset just past the value. */
  end: number;
}

const UNIVERSAL_CONSTRUCTED = new Set([0x10, 0x11]); // SEQUENCE, SET

/** Parse one DER TLV at `offset`, recursing into constructed values. */
export function parseDer(bytes: Uint8Array, offset = 0, depth = 0): Asn1Node {
  if (depth > 40) throw new CertificateError("The structure nests more than 40 levels deep, which no certificate does.");
  if (offset >= bytes.length) throw new CertificateError(`Ran off the end of the data at byte ${offset}.`);

  const tag = bytes[offset];
  const cls = tag >> 6;
  const constructed = (tag & 0x20) !== 0;
  const tagNumber = tag & 0x1f;
  if (tagNumber === 0x1f) throw new CertificateError("High-tag-number form is not used in certificates and is not supported.");

  let cursor = offset + 1;
  if (cursor >= bytes.length) throw new CertificateError(`The length byte is missing at byte ${cursor}.`);

  let length = bytes[cursor++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0) throw new CertificateError("Indefinite length is not allowed in DER.");
    if (count > 4) throw new CertificateError("A length longer than four bytes is not a certificate.");
    length = 0;
    for (let i = 0; i < count; i++) {
      if (cursor >= bytes.length) throw new CertificateError("The length field runs past the end of the data.");
      length = length * 256 + bytes[cursor++];
    }
  }

  const valueStart = cursor;
  const valueEnd = valueStart + length;
  if (valueEnd > bytes.length) {
    throw new CertificateError(`A value claims ${length} bytes at offset ${valueStart} but only ${bytes.length - valueStart} remain — the data is truncated.`);
  }

  const value = bytes.subarray(valueStart, valueEnd);
  const node: Asn1Node = { tag, tagNumber, constructed, cls, value, children: [], start: offset, end: valueEnd };

  // Context-specific constructed wrappers contain a single DER value; universal
  // SEQUENCE and SET contain a run of them.
  if (constructed && (cls !== 0 || UNIVERSAL_CONSTRUCTED.has(tagNumber))) {
    let inner = 0;
    while (inner < value.length) {
      const child = parseDer(value, inner, depth + 1);
      node.children.push(child);
      if (child.end <= inner) throw new CertificateError("A zero-length element would loop forever.");
      inner = child.end;
    }
  }

  return node;
}

/** Decode an OBJECT IDENTIFIER's value bytes into dotted notation. */
export function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const parts: number[] = [];
  // The first byte packs two arcs: 40 * first + second.
  parts.push(Math.floor(bytes[0] / 40), bytes[0] % 40);
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/** Bytes as lowercase hex, colon-separated the way openssl prints them. */
export function toHex(bytes: Uint8Array, separator = ":"): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(separator);
}

/**
 * Decode an ASN.1 time.
 *
 * `UTCTime` carries a two-digit year, and the rule is not "add 2000": values
 * below 50 are 20xx and the rest are 19xx. A certificate issued for 2049 and one
 * from 1999 are told apart by that single comparison.
 */
export function decodeTime(node: Asn1Node): Date | null {
  const text = new TextDecoder().decode(node.value).trim();
  // UTCTime: YYMMDDHHMMSSZ. GeneralizedTime: YYYYMMDDHHMMSSZ.
  const utc = node.tagNumber === 0x17;
  const m = utc
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/.exec(text)
    : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z?$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = utc ? (Number(y) < 50 ? 2000 + Number(y) : 1900 + Number(y)) : Number(y);
  const ms = Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// ---------------------------------------------------------------------------
// PEM
// ---------------------------------------------------------------------------

/** Every PEM block in a paste, in order. A chain file holds several. */
export function pemBlocks(text: string): { label: string; bytes: Uint8Array }[] {
  const out: { label: string; bytes: Uint8Array }[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[2].replace(/\s+/g, "");
    try {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      out.push({ label: m[1], bytes });
    } catch {
      throw new CertificateError(`The ${m[1]} block is not valid base64.`);
    }
  }
  return out;
}

/**
 * Certificates out of a paste, whether PEM or bare base64 DER.
 *
 * Bare base64 is accepted because that is what a certificate looks like when it
 * has been copied out of a Kubernetes secret or an appsettings file, and having
 * to add the BEGIN and END lines by hand first is an annoyance with no purpose.
 */
export function readCertificates(text: string): Uint8Array[] {
  const blocks = pemBlocks(text);
  if (blocks.length > 0) {
    const certs = blocks.filter((b) => b.label.includes("CERTIFICATE") && !b.label.includes("REQUEST"));
    if (certs.length === 0) {
      throw new CertificateError(`Found ${blocks[0].label} but no CERTIFICATE. A private key or a CSR is not a certificate.`);
    }
    return certs.map((b) => b.bytes);
  }

  const compact = text.replace(/\s+/g, "");
  if (!compact) throw new CertificateError("Nothing to read.");
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) {
    throw new CertificateError("This is neither PEM nor base64 DER. Paste the certificate including its BEGIN and END lines.");
  }
  let decoded: Uint8Array;
  try {
    const binary = atob(compact);
    decoded = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) decoded[i] = binary.charCodeAt(i);
  } catch {
    throw new CertificateError("The base64 could not be decoded.");
  }
  // Every certificate is a DER SEQUENCE, so it starts 0x30. Checking here means
  // a paste of the wrong thing is caught immediately rather than surfacing as a
  // confusing parse error several fields in.
  if (decoded[0] !== 0x30) {
    throw new CertificateError("That decoded, but it does not start with a DER SEQUENCE, so it is not a certificate. Paste the PEM including its BEGIN and END lines.");
  }
  return [decoded];
}

// ---------------------------------------------------------------------------
// Names, algorithms, extensions
// ---------------------------------------------------------------------------

const ATTRIBUTE_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.5": "serialNumber",
  "1.2.840.113549.1.9.1": "emailAddress",
  "0.9.2342.19200300.100.1.25": "DC",
};

const SIGNATURE_ALGORITHMS: Record<string, string> = {
  "1.2.840.113549.1.1.5": "SHA-1 with RSA",
  "1.2.840.113549.1.1.11": "SHA-256 with RSA",
  "1.2.840.113549.1.1.12": "SHA-384 with RSA",
  "1.2.840.113549.1.1.13": "SHA-512 with RSA",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
  "1.3.101.112": "Ed25519",
};

const KEY_ALGORITHMS: Record<string, string> = {
  "1.2.840.113549.1.1.1": "RSA",
  "1.2.840.10045.2.1": "EC",
  "1.3.101.112": "Ed25519",
};

const EXTENDED_KEY_USAGES: Record<string, string> = {
  "1.3.6.1.5.5.7.3.1": "serverAuth",
  "1.3.6.1.5.5.7.3.2": "clientAuth",
  "1.3.6.1.5.5.7.3.3": "codeSigning",
  "1.3.6.1.5.5.7.3.4": "emailProtection",
  "1.3.6.1.5.5.7.3.8": "timeStamping",
  "1.3.6.1.5.5.7.3.9": "OCSPSigning",
};

const KEY_USAGE_BITS = [
  "digitalSignature",
  "nonRepudiation",
  "keyEncipherment",
  "dataEncipherment",
  "keyAgreement",
  "keyCertSign",
  "cRLSign",
  "encipherOnly",
  "decipherOnly",
];

/** An RDNSequence as `CN=x, O=y`, most specific first, as tools print it. */
export function decodeName(node: Asn1Node): { text: string; parts: Record<string, string> } {
  const parts: Record<string, string> = {};
  const pieces: string[] = [];
  // Reversed: DER stores least specific first, everyone displays the opposite.
  for (const rdn of [...node.children].reverse()) {
    for (const attribute of rdn.children) {
      const [type, value] = attribute.children;
      if (!type || !value) continue;
      const oid = decodeOid(type.value);
      const label = ATTRIBUTE_NAMES[oid] ?? oid;
      const text = new TextDecoder().decode(value.value);
      if (!(label in parts)) parts[label] = text;
      pieces.push(`${label}=${text}`);
    }
  }
  return { text: pieces.join(", "), parts };
}

export interface Extension {
  oid: string;
  name: string;
  critical: boolean;
  node: Asn1Node;
}

const EXTENSION_NAMES: Record<string, string> = {
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.15": "keyUsage",
  "2.5.29.17": "subjectAltName",
  "2.5.29.19": "basicConstraints",
  "2.5.29.31": "cRLDistributionPoints",
  "2.5.29.32": "certificatePolicies",
  "2.5.29.35": "authorityKeyIdentifier",
  "2.5.29.37": "extKeyUsage",
  "1.3.6.1.5.5.7.1.1": "authorityInfoAccess",
  "1.3.6.1.4.1.11129.2.4.2": "signedCertificateTimestamps",
};

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

export interface Certificate {
  version: number;
  serial: string;
  signatureAlgorithm: string;
  issuer: { text: string; parts: Record<string, string> };
  subject: { text: string; parts: Record<string, string> };
  notBefore: Date | null;
  notAfter: Date | null;
  keyAlgorithm: string;
  /** Modulus size for RSA, curve size for EC, in bits. */
  keyBits: number | null;
  /** dNSName and iPAddress entries from the SAN extension. */
  altNames: string[];
  keyUsage: string[];
  extendedKeyUsage: string[];
  isCa: boolean;
  pathLength: number | null;
  subjectKeyId: string;
  authorityKeyId: string;
  crlUrls: string[];
  ocspUrls: string[];
  issuerUrls: string[];
  extensions: Extension[];
  selfSigned: boolean;
  /** SHA-256 of the whole DER, which is what a pinning config uses. */
  der: Uint8Array;
}

function findExtension(certificate: { extensions: Extension[] }, name: string): Extension | undefined {
  return certificate.extensions.find((e) => e.name === name);
}

/** Parse one DER certificate. */
export function parseCertificate(der: Uint8Array): Certificate {
  let root: Asn1Node;
  try {
    root = parseDer(der);
  } catch (e) {
    throw new CertificateError(`Not a certificate: ${(e as Error).message}`);
  }
  if (root.children.length < 3) throw new CertificateError("A certificate is a SEQUENCE of three things: the body, the signature algorithm and the signature.");

  const tbs = root.children[0];
  let index = 0;

  // Version is [0] EXPLICIT and optional; its absence means v1.
  let version = 1;
  if (tbs.children[0]?.cls === 2 && tbs.children[0]?.tagNumber === 0) {
    const inner = tbs.children[0].children[0];
    version = inner ? Number(inner.value[inner.value.length - 1] ?? 0) + 1 : 1;
    index = 1;
  }

  const serialNode = tbs.children[index++];
  const signatureNode = tbs.children[index++];
  const issuerNode = tbs.children[index++];
  const validityNode = tbs.children[index++];
  const subjectNode = tbs.children[index++];
  const publicKeyNode = tbs.children[index++];

  const issuer = decodeName(issuerNode);
  const subject = decodeName(subjectNode);
  const notBefore = validityNode?.children[0] ? decodeTime(validityNode.children[0]) : null;
  const notAfter = validityNode?.children[1] ? decodeTime(validityNode.children[1]) : null;

  const keyOid = decodeOid(publicKeyNode?.children[0]?.children[0]?.value ?? new Uint8Array());
  const keyAlgorithm = KEY_ALGORITHMS[keyOid] ?? keyOid;

  let keyBits: number | null = null;
  if (keyAlgorithm === "RSA") {
    // The BIT STRING's first byte counts unused bits; the modulus follows.
    const bitString = publicKeyNode?.children[1];
    if (bitString) {
      try {
        const key = parseDer(bitString.value.subarray(1));
        const modulus = key.children[0]?.value;
        // A leading zero byte is the sign bit of a positive INTEGER, not key material.
        if (modulus) keyBits = (modulus[0] === 0 ? modulus.length - 1 : modulus.length) * 8;
      } catch {
        keyBits = null;
      }
    }
  } else if (keyAlgorithm === "EC") {
    const curveOid = decodeOid(publicKeyNode?.children[0]?.children[1]?.value ?? new Uint8Array());
    keyBits = { "1.2.840.10045.3.1.7": 256, "1.3.132.0.34": 384, "1.3.132.0.35": 521 }[curveOid] ?? null;
  }

  // Extensions are [3] EXPLICIT, last in the body.
  const extensionsNode = tbs.children.find((c) => c.cls === 2 && c.tagNumber === 3)?.children[0];
  const extensions: Extension[] = [];
  for (const entry of extensionsNode?.children ?? []) {
    const oid = decodeOid(entry.children[0]?.value ?? new Uint8Array());
    const critical = entry.children[1]?.tagNumber === 0x01 && entry.children[1].value[0] !== 0;
    const octet = entry.children[critical ? 2 : 1] ?? entry.children[entry.children.length - 1];
    if (!octet) continue;
    let node: Asn1Node;
    try {
      node = parseDer(octet.value);
    } catch {
      continue;
    }
    extensions.push({ oid, name: EXTENSION_NAMES[oid] ?? oid, critical, node });
  }

  const shell = { extensions };

  const altNames: string[] = [];
  for (const entry of findExtension(shell, "subjectAltName")?.node.children ?? []) {
    // Context tag 2 is dNSName, 7 is iPAddress, 1 is rfc822Name, 6 is URI.
    if (entry.tagNumber === 2 || entry.tagNumber === 1 || entry.tagNumber === 6) {
      altNames.push(new TextDecoder().decode(entry.value));
    } else if (entry.tagNumber === 7) {
      altNames.push(entry.value.length === 4 ? Array.from(entry.value).join(".") : toHex(entry.value, ":"));
    }
  }

  const keyUsage: string[] = [];
  const usageExtension = findExtension(shell, "keyUsage");
  if (usageExtension) {
    const bits = usageExtension.node.value;
    const unused = bits[0] ?? 0;
    const total = (bits.length - 1) * 8 - unused;
    for (let i = 0; i < Math.min(total, KEY_USAGE_BITS.length); i++) {
      const byte = bits[1 + Math.floor(i / 8)] ?? 0;
      if (byte & (0x80 >> i % 8)) keyUsage.push(KEY_USAGE_BITS[i]);
    }
  }

  const extendedKeyUsage = (findExtension(shell, "extKeyUsage")?.node.children ?? []).map((c) => {
    const oid = decodeOid(c.value);
    return EXTENDED_KEY_USAGES[oid] ?? oid;
  });

  const basic = findExtension(shell, "basicConstraints")?.node;
  const isCa = basic?.children[0]?.tagNumber === 0x01 && basic.children[0].value[0] !== 0;
  const pathLength = basic?.children[1]?.tagNumber === 0x02 ? Number(basic.children[1].value[0]) : null;

  const crlUrls: string[] = [];
  for (const point of findExtension(shell, "cRLDistributionPoints")?.node.children ?? []) {
    const collect = (node: Asn1Node) => {
      if (node.tagNumber === 6 && node.cls === 2) crlUrls.push(new TextDecoder().decode(node.value));
      node.children.forEach(collect);
    };
    collect(point);
  }

  const ocspUrls: string[] = [];
  const issuerUrls: string[] = [];
  for (const access of findExtension(shell, "authorityInfoAccess")?.node.children ?? []) {
    const method = decodeOid(access.children[0]?.value ?? new Uint8Array());
    const location = access.children[1];
    if (!location) continue;
    const url = new TextDecoder().decode(location.value);
    if (method === "1.3.6.1.5.5.7.48.1") ocspUrls.push(url);
    else if (method === "1.3.6.1.5.5.7.48.2") issuerUrls.push(url);
  }

  const subjectKeyId = findExtension(shell, "subjectKeyIdentifier") ? toHex(findExtension(shell, "subjectKeyIdentifier")!.node.value) : "";
  const akiNode = findExtension(shell, "authorityKeyIdentifier")?.node.children.find((c) => c.tagNumber === 0);
  const authorityKeyId = akiNode ? toHex(akiNode.value) : "";

  return {
    version,
    serial: toHex(serialNode?.value ?? new Uint8Array()),
    signatureAlgorithm: SIGNATURE_ALGORITHMS[decodeOid(signatureNode?.children[0]?.value ?? new Uint8Array())] ?? decodeOid(signatureNode?.children[0]?.value ?? new Uint8Array()),
    issuer,
    subject,
    notBefore,
    notAfter,
    keyAlgorithm,
    keyBits,
    altNames,
    keyUsage,
    extendedKeyUsage,
    isCa,
    pathLength,
    subjectKeyId,
    authorityKeyId,
    crlUrls,
    ocspUrls,
    issuerUrls,
    extensions,
    selfSigned: issuer.text === subject.text && issuer.text !== "",
    der,
  };
}

/** SHA-256 of the DER, the fingerprint every pinning configuration uses. */
export async function fingerprint(der: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new CertificateError("WebCrypto is unavailable, so a fingerprint cannot be computed here.");
  const digest = await subtle.digest("SHA-256", der.subarray(0) as unknown as ArrayBuffer);
  return toHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface CertFinding {
  level: "error" | "warn" | "info";
  subject: string;
  message: string;
}

export const DAY_MS = 86_400_000;

/** Whole days until expiry, negative once expired. */
export function daysUntil(date: Date | null, now = Date.now()): number | null {
  if (!date) return null;
  return Math.floor((date.getTime() - now) / DAY_MS);
}

/**
 * What is wrong with this certificate, or about to be.
 *
 * Ordered by what actually causes outages. Expiry first, because it is the one
 * that takes a service down at a predictable moment nobody diarised; then the
 * things that make a handshake fail in ways the error message does not explain.
 */
export function certificateFindings(cert: Certificate, now = Date.now()): CertFinding[] {
  const findings: CertFinding[] = [];
  const name = cert.subject.parts.CN || cert.subject.text || "certificate";

  const remaining = daysUntil(cert.notAfter, now);
  if (remaining === null) {
    findings.push({ level: "warn", subject: name, message: "The notAfter date could not be read." });
  } else if (remaining < 0) {
    findings.push({ level: "error", subject: name, message: `Expired ${Math.abs(remaining)} day(s) ago, on ${cert.notAfter!.toISOString().slice(0, 10)}.` });
  } else if (remaining <= 14) {
    findings.push({ level: "error", subject: name, message: `Expires in ${remaining} day(s), on ${cert.notAfter!.toISOString().slice(0, 10)}.` });
  } else if (remaining <= 45) {
    findings.push({ level: "warn", subject: name, message: `Expires in ${remaining} day(s). Renewal usually needs a change window, so this is the point to raise one.` });
  }

  if (cert.notBefore && cert.notBefore.getTime() > now) {
    findings.push({
      level: "error",
      subject: name,
      message: `Not valid until ${cert.notBefore.toISOString().slice(0, 10)}. A clock skew of even a few minutes between two servers produces exactly this, and the handshake error says nothing about time.`,
    });
  }

  if (cert.altNames.length === 0 && !cert.isCa) {
    findings.push({
      level: "error",
      subject: name,
      message: "No subjectAltName. Every current client ignores the CN for hostname matching, so a certificate with only a CN fails verification everywhere regardless of what the CN says.",
    });
  }

  if (/SHA-1/i.test(cert.signatureAlgorithm)) {
    findings.push({ level: "error", subject: name, message: `Signed with ${cert.signatureAlgorithm}. SHA-1 signatures are rejected by current clients.` });
  }

  if (cert.keyAlgorithm === "RSA" && cert.keyBits !== null && cert.keyBits < 2048) {
    findings.push({ level: "error", subject: name, message: `${cert.keyBits}-bit RSA key. Below 2048 bits is refused.` });
  }

  if (cert.isCa && cert.extendedKeyUsage.includes("serverAuth")) {
    findings.push({
      level: "warn",
      subject: name,
      message: "This is a CA certificate that also claims serverAuth. Presenting a CA certificate as a server certificate is a common misconfiguration when a chain file is assembled in the wrong order.",
    });
  }

  if (!cert.isCa && cert.keyUsage.includes("keyCertSign")) {
    findings.push({ level: "warn", subject: name, message: "keyCertSign is set on a certificate that is not a CA. These contradict each other and some verifiers reject it." });
  }

  if (cert.selfSigned && !cert.isCa) {
    findings.push({ level: "warn", subject: name, message: "Self-signed and not a CA. It will only be accepted where it has been explicitly trusted." });
  }

  const totalDays = cert.notBefore && cert.notAfter ? Math.round((cert.notAfter.getTime() - cert.notBefore.getTime()) / DAY_MS) : 0;
  if (totalDays > 398 && !cert.isCa) {
    findings.push({
      level: "warn",
      subject: name,
      message: `Valid for ${totalDays} days. Public clients refuse leaf certificates issued for more than 398 days; an internal CA can still mint them, and they then fail only in a browser.`,
    });
  }

  return findings;
}

/** Whether this certificate carries what mTLS needs at each end. */
export function mtlsReadiness(cert: Certificate): CertFinding[] {
  const findings: CertFinding[] = [];
  const name = cert.subject.parts.CN || "certificate";
  if (cert.extendedKeyUsage.length === 0) {
    findings.push({ level: "info", subject: name, message: "No extKeyUsage, so the certificate is unrestricted and may be used as either end. Many verifiers accept this; some do not." });
    return findings;
  }
  if (!cert.extendedKeyUsage.includes("clientAuth")) {
    findings.push({
      level: "warn",
      subject: name,
      message: "No clientAuth in extKeyUsage. Presented as a client certificate this is rejected — and the server's error is usually just `handshake failure`.",
    });
  }
  if (!cert.extendedKeyUsage.includes("serverAuth")) {
    findings.push({ level: "info", subject: name, message: "No serverAuth, so this cannot be used as a server certificate." });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export interface ChainReport {
  /** Certificates in the order presented. */
  certificates: Certificate[];
  /** The order they should be in: leaf first, then each issuer. */
  ordered: Certificate[];
  findings: CertFinding[];
}

/**
 * Check a chain as a TLS peer would look at it.
 *
 * The rule that trips people is that order matters: the leaf must come first and
 * each certificate must be followed by its issuer. A chain assembled
 * alphabetically, or with the root first, is a chain many clients reject — and
 * the root should not be in the file at all, since a client that does not
 * already trust it will not start trusting it because the server sent it.
 */
export function analyseChain(certificates: Certificate[], now = Date.now()): ChainReport {
  const findings: CertFinding[] = [];
  if (certificates.length === 0) return { certificates, ordered: [], findings };

  const bySubject = new Map(certificates.map((c) => [c.subject.text, c]));
  const leaves = certificates.filter((c) => !c.isCa);
  const leaf = leaves[0] ?? certificates[0];

  if (leaves.length > 1) {
    findings.push({ level: "warn", subject: "chain", message: `${leaves.length} non-CA certificates in one file. A chain should carry exactly one leaf.` });
  }

  const ordered: Certificate[] = [];
  const seen = new Set<string>();
  let current: Certificate | undefined = leaf;
  while (current && !seen.has(current.subject.text)) {
    ordered.push(current);
    seen.add(current.subject.text);
    if (current.selfSigned) break;
    const issuer: Certificate | undefined = bySubject.get(current.issuer.text);
    if (!issuer) {
      findings.push({
        level: "error",
        subject: current.subject.parts.CN || "certificate",
        message: `Its issuer "${current.issuer.text}" is not in this file. A client that does not already hold that intermediate cannot build a path — which is the classic "works in my browser, fails from curl" split, because browsers cache intermediates and other clients do not.`,
      });
      break;
    }
    current = issuer;
  }

  if (certificates.length !== ordered.length) {
    const extra = certificates.filter((c) => !seen.has(c.subject.text));
    for (const cert of extra) {
      findings.push({ level: "warn", subject: cert.subject.parts.CN || "certificate", message: "In the file but not part of the path from the leaf. It is being sent for nothing." });
    }
  }

  if (ordered.length > 0 && certificates[0] !== ordered[0]) {
    findings.push({
      level: "error",
      subject: "chain",
      message: "The first certificate in the file is not the leaf. Order matters: leaf first, then each issuer in turn. Many clients reject a chain that starts anywhere else.",
    });
  }

  const root = ordered[ordered.length - 1];
  if (root?.selfSigned && ordered.length > 1) {
    findings.push({
      level: "info",
      subject: root.subject.parts.CN || "root",
      message: "The self-signed root is included. It is harmless but pointless — a client that does not already trust it will not start trusting it because the server sent it.",
    });
  }

  for (const cert of ordered) {
    const remaining = daysUntil(cert.notAfter, now);
    if (remaining !== null && remaining < 0 && cert !== leaf) {
      findings.push({ level: "error", subject: cert.subject.parts.CN || "intermediate", message: `An intermediate in the chain expired ${Math.abs(remaining)} day(s) ago. The leaf being valid does not save it.` });
    }
  }

  return { certificates, ordered, findings };
}

/**
 * Does this certificate cover the hostname?
 *
 * The wildcard rule is narrower than people expect: `*.example.com` matches
 * `a.example.com` and not `example.com`, and never `a.b.example.com`. One label,
 * leftmost only.
 */
export function matchesHostname(cert: Certificate, hostname: string): { matched: boolean; by?: string } {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return { matched: false };
  for (const name of cert.altNames) {
    const candidate = name.toLowerCase();
    if (candidate === host) return { matched: true, by: name };
    if (candidate.startsWith("*.")) {
      const suffix = candidate.slice(1);
      const labelsMatch = host.endsWith(suffix) && host.slice(0, host.length - suffix.length).split(".").length === 1;
      if (labelsMatch) return { matched: true, by: name };
    }
  }
  return { matched: false };
}
