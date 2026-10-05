; ui/buttons.lisp / live Lisp drawing and interaction.
(defn ui-button [id caption origin size active]
  (scope
    (fill (if active (get :ui-accent)
              (if (or (hit? origin size) (focused? id)) "#252e29" "#191f1b")))
    (rect origin size)
    (fill (if active "#162019" (get :ui-text)))
    (text [(+ (nth origin 0) 12) (+ (nth origin 1) 8)] caption))
  (region id caption origin size)
  (or (and (pointer-pressed?) (hit? origin size)) (activated? id)))

(defn ui-tab [id caption x active]
  (when (ui-button (str "tab-" id) caption [x 58] [70 32]
                   (= active id))
    (set! :tab id)))

; A compact pixel play glyph with a full accessible label.
(defn ui-run-button [id label x y]
  (let [origin [x y] size [20 24]]
    (fill (if (or (hit? origin size) (focused? id)) "#344339" (get :ui-panel)))
    (rect origin size)
    (fill (get :ui-accent))
    (line [(+ x 5) (+ y 6)] [(+ x 5) (+ y 17)] 1)
    (line [(+ x 5) (+ y 6)] [(+ x 13) (+ y 12)] 1)
    (line [(+ x 13) (+ y 12)] [(+ x 5) (+ y 17)] 1)
    (region id label origin size)
    (or (activated? id) (and (pointer-pressed?) (hit? origin size)))))
