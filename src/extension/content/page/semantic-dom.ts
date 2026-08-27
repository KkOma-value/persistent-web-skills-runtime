import type {
  JsonObject,
  SemanticDomSnapshot,
  SemanticElementSnapshot,
  SemanticLocator,
} from "../../../shared/types";

const STABLE_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-qa",
  "name",
  "type",
  "placeholder",
] as const;

function normalized(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function comparable(value: string | null | undefined): string {
  return normalized(value).toLocaleLowerCase();
}

function textWithoutHiddenDescendants(element: Element): string {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (!parent?.closest('[aria-hidden="true"]')) pieces.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return normalized(pieces.join(" "));
}

export function implicitRole(element: Element): string | undefined {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;

  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "main") return "main";
  if (tag === "nav") return "navigation";
  if (tag === "header") return "banner";
  if (tag === "form") return "form";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "listitem";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "img") return "img";
  if (tag === "h1") return "heading";

  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type !== "hidden") return "textbox";
  }

  return undefined;
}

export function elementLabel(element: Element, doc: Document = document): string | undefined {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const labelText = Array.from(element.labels ?? [])
      .map((label) => label.textContent)
      .join(" ");
    if (normalized(labelText)) return normalized(labelText);
  }

  const id = element.getAttribute("id");
  if (id) {
    const labels = [...doc.querySelectorAll("label")].filter(
      (label) => label.htmlFor === id,
    );
    const labelText = labels.map((label) => label.textContent).join(" ");
    if (normalized(labelText)) return normalized(labelText);
  }

  const parentLabel = element.closest("label");
  return normalized(parentLabel?.textContent) || undefined;
}

export function accessibleName(element: Element, doc: Document = document): string | undefined {
  const ariaLabel = normalized(element.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent)
      .join(" ");
    if (normalized(value)) return normalized(value);
  }

  const label = elementLabel(element, doc);
  if (label) return label;

  const alt = normalized(element.getAttribute("alt"));
  if (alt) return alt;

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (["button", "submit", "reset"].includes(type) && normalized(element.value)) {
      return normalized(element.value);
    }
  }

  const text = textWithoutHiddenDescendants(element);
  const role = implicitRole(element);
  const textNamingRoles = new Set([
    "button",
    "link",
    "heading",
    "listitem",
    "option",
    "tab",
    "menuitem",
  ]);
  if (text && (textNamingRoles.has(role ?? "") || element.children.length === 0)) {
    return text.slice(0, 160);
  }

  return normalized(element.getAttribute("title")) || undefined;
}

function allElements(root: ParentNode): Element[] {
  const own = root instanceof Element ? [root] : [];
  return [...own, ...root.querySelectorAll("*")];
}

function matchesAttributes(element: Element, attributes: Record<string, string>): boolean {
  return Object.entries(attributes).every(
    ([name, value]) => element.getAttribute(name) === value,
  );
}

export function resolveAllSemanticLocators(
  locator: SemanticLocator,
  root: ParentNode = document,
): Element[] {
  const doc = root instanceof Document ? root : root.ownerDocument ?? document;
  const elements = allElements(root);

  if (locator.role) {
    const roleMatches = elements.filter(
      (element) => comparable(implicitRole(element)) === comparable(locator.role),
    );
    if (locator.name) {
      return roleMatches.filter(
        (element) => comparable(accessibleName(element, doc)) === comparable(locator.name),
      );
    }
    return roleMatches;
  }

  if (locator.label) {
    return elements.filter(
      (element) => comparable(elementLabel(element, doc)) === comparable(locator.label),
    );
  }

  if (locator.attributes && Object.keys(locator.attributes).length > 0) {
    return elements.filter((element) => matchesAttributes(element, locator.attributes!));
  }

  if (locator.text) {
    return elements.filter(
      (element) => comparable(element.textContent) === comparable(locator.text),
    );
  }

  if (locator.css) {
    try {
      return [...root.querySelectorAll(locator.css)];
    } catch {
      return [];
    }
  }

  return [];
}

export function resolveSemanticLocator(
  locator: SemanticLocator,
  root: ParentNode = document,
): Element | null {
  return resolveAllSemanticLocators(locator, root)[0] ?? null;
}

function isStableId(value: string): boolean {
  return value.length > 0 && !/\d{4,}|[0-9a-f]{8,}/i.test(value);
}

export function semanticLocatorForElement(
  element: Element,
  doc: Document = document,
): SemanticLocator {
  const role = implicitRole(element);
  const name = accessibleName(element, doc);
  if (role && name) return { role, name };

  const label = elementLabel(element, doc);
  if (label) return { label };

  const attributes: Record<string, string> = {};
  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value) attributes[attribute] = value;
  }
  const id = element.getAttribute("id");
  if (id && isStableId(id)) attributes.id = id;
  if (Object.keys(attributes).length > 0) return { attributes };

  const text = normalized(element.textContent);
  if (text) return { text: text.slice(0, 160) };

  return { css: element.tagName.toLowerCase() };
}

export function snapshotElement(
  element: Element,
  doc: Document = document,
): SemanticElementSnapshot {
  const attributes = Object.fromEntries(
    [...element.attributes]
      .filter(({ name }) =>
        ["id", "name", "type", "placeholder", "data-testid", "data-test", "data-qa"].includes(
          name,
        ),
      )
      .map(({ name, value }) => [name, value]),
  );
  return {
    tag: element.tagName.toLowerCase(),
    role: implicitRole(element),
    name: accessibleName(element, doc),
    label: elementLabel(element, doc),
    text: normalized(element.textContent).slice(0, 200) || undefined,
    attributes,
  };
}

export function captureSemanticDom(
  doc: Document = document,
  maxElements = 300,
): SemanticDomSnapshot {
  const relevant = allElements(doc)
    .filter((element) => {
      const role = implicitRole(element);
      const text = normalized(element.textContent);
      const isTestHook = element.matches("[data-testid], [data-test], [data-qa]");
      const isLabel = element.matches("label");
      // Long, unlabelled copy is usually dynamic page content. Keep landmarks and
      // compact visible text for repair without serializing an entire document.
      if (!role && !isTestHook && !isLabel && text.length > 180) return false;
      return Boolean(
        role ||
          isTestHook ||
          isLabel ||
          (element.children.length === 0 && text),
      );
    })
    .slice(0, maxElements)
    .map((element) => snapshotElement(element, doc));

  return {
    url: doc.location.href,
    title: doc.title,
    elements: relevant,
    capturedAt: Date.now(),
  };
}

export function interpolate(value: string, input: JsonObject): string {
  return value.replace(/{{\s*([\w.]+)\s*}}/g, (_match, path: string) => {
    const resolved = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, input);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

export function interpolateLocator(
  locator: SemanticLocator,
  input: JsonObject,
): SemanticLocator {
  return {
    role: locator.role ? interpolate(locator.role, input) : undefined,
    name: locator.name ? interpolate(locator.name, input) : undefined,
    label: locator.label ? interpolate(locator.label, input) : undefined,
    text: locator.text ? interpolate(locator.text, input) : undefined,
    css: locator.css ? interpolate(locator.css, input) : undefined,
    attributes: locator.attributes
      ? Object.fromEntries(
          Object.entries(locator.attributes).map(([name, value]) => [
            name,
            interpolate(value, input),
          ]),
        )
      : undefined,
  };
}
