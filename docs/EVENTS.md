# Generic events

`hg.Events` is a shared JavaScript/Lisp namespace for independent dispatchers.
Operations receive the events instance explicitly and do not require `this`.
Dispatchers have no automatic connection to an app or its scene hooks.

| Operation | Result |
| --- | --- |
| `Events.new()` | A new independent dispatcher. |
| `Events.on(events, name, handler)` | Registers the handler once and returns it. |
| `Events.off(events, name, handler)` | Removes the handler if present and returns it. |
| `Events.emit(events, name, value)` | Dispatches the value and returns the events instance. |

Each operation requires exactly the listed arguments. Event names must be primitive
strings, handlers must be functions, and payloads use normal language-value admission:
undefined becomes nil, finite scalar numbers are required, and compound values retain
their identities. Instances and the namespace are ordinary registered host records;
dispatch state uses private dunder fields. They are not JSON snapshots.

```js
import hg from '../hg/hg.js';
const events = hg.Events.new();
const handler = hg.Events.on(events, 'changed', (value) => console.log(value));
hg.Events.emit(events, 'changed', 42);
hg.Events.off(events, 'changed', handler);
```

```lisp
(let events (Events.new))
(let handler (Events.on events "changed" (fn (value) { (print value) })))
(Events.emit events "changed" 42)
(Events.off events "changed" handler)
```

Handlers run synchronously in registration order and receive one payload argument.
Registering the same function again for the same name does not duplicate or reorder
it. Removing and registering it again moves it to the end. Different event names
and instances maintain independent subscriptions. Removing an absent handler is harmless.

Every call to `emit` snapshots its handlers immediately. Subscription changes do
not alter that snapshot and apply to subsequent emissions. Nested emissions on the
same instance queue in emission order behind the current emission; the outermost
`emit` drains the queue before returning. Nested `emit` returns after enqueueing.
Another instance dispatches independently. Payloads are shared values, not copies.

A synchronous handler error propagates to the outermost emitter, skips remaining
handlers, and discards queued emissions. The dispatcher resets its dispatch state
and is reusable; completed effects and subscription changes remain. Handler return
values are ignored, and promises are not awaited or given automatic rejection handlers.

Scene `(on render ...)`, `(on update ...)`, and other `on` forms define named
runtime hooks. The scheduler, lifecycle, and input services invoke those hooks
directly using their existing contracts. Generic `Events.on` does not subscribe to
them or replace that mechanism. Owners remove subscriptions when appropriate;
scene replacement does not automatically clear independent dispatchers.
