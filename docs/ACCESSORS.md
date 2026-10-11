# Explicit storage access

Engine records have no getters, setters, or Proxies. No engine object is frozen
or sealed. `Data.get(value, key)`, `Data.put(value, key, replacement)`, and
`Data.values(value)` perform storage access explicitly. Lisp `put` and dot
expressions use these operations. `(get name)` resolves a binding; `(get name.x)`
explicitly reads a path. Parenthesized dot selectors such as `items.(+ i 1)` and
`dict.(get key)` compute an integer index or string key, and also work in `set`
targets. `Types.computedAccess` and `Types.setComputedAccess` validate these keys
before applying the same storage operations. Raw properties are ordinary data.

| Representation | Explicit access and ownership |
| --- | --- |
| Lists and dictionaries | Native JS arrays and plain untyped objects. `Data.values` returns the same collection. `Data.get` and `Data.put` validate keys and values; dictionary reads use own fields. |
| Standalone vectors | `__type__` and ordinary `x`/`y`/`z`/`w` fields hold the value. Numeric `Data.get`/`put` indices select these fields; Lisp dot access supports existing swizzles. `Data.values` returns a component snapshot. Direct JS field writes bypass validation. |
| Deferred token/text snapshots | Sparse native arrays and a builder held in private weak metadata capture source and offsets. `Data.get` builds a requested entry; `Data.values` builds all entries and clears the builder. `len` reads length without materialization. Copying, equality, serialization, insertion, and removal materialize explicitly when needed. Direct JS indexing does not build entries. Old snapshots retain their source. |
| Module namespaces | Plain objects hold ordinary `{ value }` cells shared by generated lexical references and imports. Private weak metadata identifies the cell map. `Data.get` reads a cell; `Data.put` writes or creates one. `Data.values` projects current values; editing the projection does not edit the module. |
| Matrix columns | `__column__` holds the matrix, column index, and size. `Data.get`/`put` access the original matrix. `Data.values` snapshots current components. Cached column records preserve identity and aliasing. |
| Packed vectors/matrices | `__numericView__` identifies an owner, layout, offset, and component count. Reads follow the current owner buffer through many reallocation. Writes validate and mark its revision. `Data.values` returns a component snapshot. |
| Structs | `__struct__` identifies the layout, storage owner, offset, and cached children. `Structures.structuredGet`/`structuredPut` read/write fields. Whole-field writes validate before mutation. `Data.values` projects current fields. |
| Arrays and many | `__collection__` holds capacity, stride, length, offsets, cached views. `Structures.collectionInfo` synchronizes observations with the owner. Nested many length is explicitly read/written in the containing buffer. Inserts/removals mark revisions. |
| Registered host records | Own fields are read/written explicitly, preserving identity. Host writes use a data descriptor so `__proto__` becomes an own field; no getter or setter is installed. |

Treat `__name__` fields on typed engine records as implementation data. Ordinary
dictionary keys, including `__type__`, `type`, `values`, and `__cells`, are payload. Modify live language storage through
namespace operations: raw buffer edits bypass validation and revision tracking.
`Data.values` returns backing storage for ordinary materialized collections and
standalone matrices, and snapshots for all vectors, packed views, columns, structs, and modules.
Use `Data.put` to change live aliases. Materialize deferred lists before editing
their backing arrays directly.

`Data.serializeData` emits native JSON collections and explicit data snapshots
for typed values. Vectors encode `__type__` and named components; matrices encode `type`/`values`;
structs encode fields, and arrays/many encode live elements. Private ownership
metadata is excluded. `Data.deserializeData` parses ordinary JSON with finite
number validation; tags remain payload and do not restore typed storage or aliases.
Native resources, executables, and promises retain opaque lifetime rules.

Runtime-created textures carry an own `__type__: '__texture2d__'` field. In Lisp,
`image.__type__` and `(get image.__type__)` read that marker, including for registered
caller-frozen handles without an own tag. Texture metadata is read-only through
language access. `(type image)` returns `"__texture2d__"` and `(texture2d? image)`
recognizes registered textures; ordinary dictionaries with that tag do not qualify.
Texture handles retain resource identity and cannot be serialized to JSON.

Binding handles carry `__type__: '__binding__'` and a name; explicit Lisp field
access reads registered metadata. `App.inspect` enumerates handles, `App.read`
reads the current cell, and `App.write` replaces its value using ordinary `set`
mutability rules. Handles are opaque identity values for copying/equality, not
dictionaries or serializable snapshots. References follow committed same-name
patches, but removal, fresh serving, or disposal permanently invalidates them.
Their kind remains `__binding__` after invalidation; read/write validate liveness
and owner separately from type recognition.

Typed-kind and opaque-handle registration follow value identity through weak metadata
registries. Native lists/dicts require no registration. Editing a typed record's
`__type__` or `type` label does not re-register its kind. Registries support
caller-frozen handles; the engine does not freeze them. They contain no current app
or scheduler state.
