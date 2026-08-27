import { stableHash } from "../../../shared/hash";
import type {
  FingerprintValidationResult,
  PageFingerprint,
  SkillDependency,
  WebSkill,
} from "../../../shared/types";
import { accessibleName, implicitRole, resolveSemanticLocator } from "./semantic-dom";

function elementSignature(element: Element): string {
  return stableHash({
    tag: element.tagName.toLowerCase(),
    role: implicitRole(element),
    name: accessibleName(element, element.ownerDocument),
    type: element.getAttribute("type"),
    testId:
      element.getAttribute("data-testid") ??
      element.getAttribute("data-test") ??
      element.getAttribute("data-qa"),
  });
}

export function capturePageFingerprint(
  dependencies: SkillDependency[],
  urlPattern: string,
  doc: Document = document,
): PageFingerprint {
  const landmarks = dependencies.map((dependency) => {
    const element = resolveSemanticLocator(dependency.locator, doc);
    return {
      dependencyId: dependency.id,
      locator: dependency.locator,
      matched: Boolean(element),
      signature: element ? elementSignature(element) : undefined,
    };
  });

  return {
    urlPattern,
    landmarks,
    fingerprintHash: stableHash(
      landmarks.map(({ dependencyId, matched, signature }) => ({
        dependencyId,
        matched,
        signature,
      })),
    ),
    capturedAt: Date.now(),
  };
}

export function validatePageFingerprint(
  skill: WebSkill,
  doc: Document = document,
): FingerprintValidationResult {
  const currentFingerprint = capturePageFingerprint(
    skill.dependencies,
    skill.urlPattern,
    doc,
  );
  const requiredIds = new Set(
    skill.dependencies.filter((dependency) => dependency.required).map((dependency) => dependency.id),
  );
  const missingDependencyIds = currentFingerprint.landmarks
    .filter((landmark) => requiredIds.has(landmark.dependencyId) && !landmark.matched)
    .map((landmark) => landmark.dependencyId);
  const matchedCount = currentFingerprint.landmarks.filter((landmark) => landmark.matched).length;
  const score =
    currentFingerprint.landmarks.length === 0
      ? 1
      : matchedCount / currentFingerprint.landmarks.length;
  const valid = missingDependencyIds.length === 0 && score >= 0.75;

  return {
    valid,
    score,
    missingDependencyIds,
    currentFingerprint,
    reason: valid
      ? `Dependency fingerprint compatible (${Math.round(score * 100)}%)`
      : `Missing required dependencies: ${missingDependencyIds.join(", ") || "fingerprint drift"}`,
  };
}
