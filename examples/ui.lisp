; Ordinary Lisp widgets, persistent state, menus, and docking.
(await (import "../hg/ui.lisp"))
(let count 0)
(let message nil)
(let workspace nil)
(let desktop nil)
(let build-ui (fn ()
  (set message (ui-label (if (= count 0) "Hello" $"Clicked {count} times")))
  (set workspace (ui-dock
    (ui-pane "Hello"
      message
      (ui-button
        (ui-vbox (gap 4) (align "center")
          (ui-icon "../editor/icons/code.png")
          "Click me")
        (on click () {
        (set count (+ count 1))
        (set message.props.value $"Clicked {count} times")
      })))
    (ui-pane "Instructions"
      (ui-scroll (ui-prop "scroll-x" true)
        "Drag a title to float a pane."
        "Hold near another pane's edge to dock."
        "Resize floating edges/corners or dock dividers."
        "Wheel to scroll; drag a scrollbar to move farther."))))
  (set desktop (ui-new (ui-vbox (gap 0)
    (ui-menu
      (ui-dropdown "Actions"
        (ui-button "Reset count" (on click () {
          (set count 0)
          (set message.props.value "Hello")
        })))
      (ui-label "Composable Lisp UI"))
    workspace
    (ui-taskbar workspace (ui-label "Minimized")))))))

(on attach () (build-ui) (ui-mount desktop))
(on detach () (ui-unmount desktop))
(on update (context) (ui-update desktop context))
(on render (context) (ui-render desktop context))
