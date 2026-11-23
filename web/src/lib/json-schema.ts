type Schema = Record<string, unknown>;

const isObject = (v: unknown): v is Schema => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The schema with its local `$ref`s ("#/$defs/repo") replaced by what they point at. The editor's suggestion
 * library finds property names through a `$ref` but not the values that go with them, so it is given the flattened
 * form. Keywords next to a `$ref` (a description) win over the ones inside it. A reference that points back into
 * itself is left as it is, so a recursive schema can't loop.
 */
export function inlineRefs(schema: Schema): Schema {
  const walk = (node: unknown, seen: string[]): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, seen));
    if (!isObject(node)) return node;

    const ref = node.$ref;
    if (typeof ref === "string" && ref.startsWith("#/") && !seen.includes(ref)) {
      const target = ref
        .slice(2)
        .split("/")
        .reduce<unknown>((at, part) => (isObject(at) ? at[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined), schema);
      if (isObject(target)) {
        const beside = { ...node };
        delete beside.$ref;
        return walk({ ...target, ...beside }, [...seen, ref]);
      }
    }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, seen)]));
  };
  return walk(schema, []) as Schema;
}
