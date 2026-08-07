import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Base64Tool } from "./Base64Tool";

/**
 * One real tool screen, rendered.
 *
 * The suite is otherwise almost entirely pure-logic tests over `tools/lib`,
 * which means a screen can be wired to the wrong function, or not wired at all,
 * without anything failing. This is the cheapest guard against that: drive the
 * tool the way a person does and check the answer appears.
 */
describe("Base64Tool", () => {
  const boxes = () => screen.getAllByRole("textbox") as HTMLTextAreaElement[];
  const plain = () => boxes()[0];
  const encoded = () => boxes()[1];

  it("opens with a worked example rather than two empty boxes", () => {
    render(<Base64Tool />);
    expect(plain().value).toBe("Hello, DevHelper!");
    expect(encoded().value).toBe("SGVsbG8sIERldkhlbHBlciE=");
  });

  it("encodes on demand", () => {
    render(<Base64Tool />);
    fireEvent.change(plain(), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Encode/ }));
    expect(encoded().value).toBe("aGVsbG8=");
  });

  it("decodes back the other way", () => {
    render(<Base64Tool />);
    fireEvent.change(encoded(), { target: { value: "aGVsbG8=" } });
    fireEvent.click(screen.getByRole("button", { name: /Decode/ }));
    expect(plain().value).toBe("hello");
  });

  it("round-trips non-ASCII, which a naive btoa would throw on", () => {
    render(<Base64Tool />);
    fireEvent.change(plain(), { target: { value: "héllo → ✓" } });
    fireEvent.click(screen.getByRole("button", { name: /Encode/ }));
    fireEvent.change(plain(), { target: { value: "cleared" } });
    fireEvent.click(screen.getByRole("button", { name: /Decode/ }));
    expect(plain().value).toBe("héllo → ✓");
  });

  it("does not clear the input on invalid Base64", () => {
    render(<Base64Tool />);
    fireEvent.change(encoded(), { target: { value: "!!!not base64!!!" } });
    fireEvent.click(screen.getByRole("button", { name: /Decode/ }));
    expect(plain().value).toBe("Hello, DevHelper!");
  });
});
