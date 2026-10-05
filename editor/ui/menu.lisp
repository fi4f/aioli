; ui/menu.lisp / live Lisp drawing and interaction.
(defn menu-action [id label shortcut x y width enabled checked]
  (let [origin [x y] size [width 30]
        hovered (and enabled (or (hit? origin size) (focused? id)))]
    (fill (if hovered "#303d33" (get :ui-panel))) (rect origin size)
    (fill (if enabled (get :ui-text) "#526258"))
    (when (= checked true) (text [(+ x 6) (+ y 6)] "x"))
    (text [(+ x 24) (+ y 6)] label)
    (when (not (= shortcut ""))
      (fill (if enabled (get :ui-muted) "#526258"))
      (text [(+ x width -100) (+ y 6)] shortcut))
    (menu-region id label origin size enabled checked)
    (if (and enabled (or (activated? id) (and (pointer-pressed?) (hit? origin size))))
      (do (set! :menu false) (set! :file-context false) true) false)))

(defn menu-divider [x y width]
  (fill "#303b32") (rect [(+ x 8) y] [(- width 16) 1]))
