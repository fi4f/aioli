; Ordinary Lisp widgets, persistent state, menus, and docking.
(await (import "../hg/ui.lisp"))
(let count 0)
(let message nil)
(let workspace nil)
(let desktop nil)
(let build-ui (fn ()
  (set message (label (if (= count 0) "Hello" $"Clicked {count} times")))
  (set workspace (ui-dock
    (ui-pane "Hello"
      message
      (button "Click me" (on click () {
        (set count (+ count 1))
        (set message.props.value $"Clicked {count} times")
      })))
    (ui-pane "Instructions"
      (label "Drag a title to float a pane.")
      (label "Hold near another pane's edge to dock.")
      (label "Resize floating edges/corners or dock dividers."))))
  (set desktop (ui-new (ui-vbox (ui-style (dict "gap" 0))
    (ui-menu
      (ui-dropdown "Actions"
        (button "Reset count" (on click () {
          (set count 0)
          (set message.props.value "Hello")
        })))
      (label "Composable Lisp UI"))
    workspace
    (ui-taskbar workspace (label "Minimized")))))))

(on attach () (build-ui) (ui-mount desktop))
(on detach () (ui-unmount desktop))
(on update (context) (ui-update desktop context))
(on render (context) (ui-render desktop context))
(on pointerdown (event) (ui-input desktop "pointerdown" event))
(on pointermove (event) (ui-input desktop "pointermove" event))
(on pointerup (event) (ui-input desktop "pointerup" event))
(on pointercancel (event) (ui-input desktop "pointercancel" event))
(on pointerleave (event) (ui-input desktop "pointerleave" event))
(on wheel (event) (ui-input desktop "wheel" event))
(on keydown (event) (ui-input desktop "keydown" event))
(on keyup (event) (ui-input desktop "keyup" event))
