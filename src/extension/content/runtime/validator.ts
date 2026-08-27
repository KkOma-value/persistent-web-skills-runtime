import type {
  JsonObject,
  ValidationResult,
  ValidationRule,
} from "../../../shared/types";
import {
  interpolate,
  interpolateLocator,
  resolveSemanticLocator,
} from "../page/semantic-dom";

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export async function validateResult(
  rule: ValidationRule,
  input: JsonObject = {},
  doc: Document = document,
): Promise<ValidationResult> {
  if (rule.type === "url-match") {
    const pattern = interpolate(rule.value, input);
    try {
      const valid = new RegExp(pattern).test(doc.location.href);
      return {
        valid,
        reason: valid ? `URL matches ${pattern}` : `URL did not match ${pattern}`,
      };
    } catch {
      return { valid: false, reason: `Invalid URL validation pattern: ${pattern}` };
    }
  }

  if (rule.type === "element-exists" || rule.type === "element-not-exists") {
    const locator = interpolateLocator(rule.locator, input);
    const exists = Boolean(resolveSemanticLocator(locator, doc));
    const valid = rule.type === "element-exists" ? exists : !exists;
    return {
      valid,
      reason: valid
        ? `${rule.type === "element-exists" ? "Found" : "Did not find"} expected element`
        : `${rule.type === "element-exists" ? "Missing" : "Unexpectedly found"} expected element`,
    };
  }

  if (rule.type === "text-contains") {
    const expected = interpolate(rule.value, input);
    const target = rule.locator
      ? resolveSemanticLocator(interpolateLocator(rule.locator, input), doc)
      : doc.body;
    const valid = normalized(target?.textContent).includes(normalized(expected));
    return {
      valid,
      reason: valid ? `Found text \"${expected}\"` : `Text \"${expected}\" was not found`,
    };
  }

  const element = resolveSemanticLocator(interpolateLocator(rule.locator, input), doc);
  const expected = interpolate(rule.value, input);
  const actual = element?.getAttribute(rule.attribute);
  const valid = actual === expected;
  return {
    valid,
    reason: valid
      ? `${rule.attribute} equals \"${expected}\"`
      : `${rule.attribute} was \"${actual ?? "missing"}\", expected \"${expected}\"`,
  };
}
