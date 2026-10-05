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
    (if (icon-available? "assets/editor-icons/play.png")
      (icon "assets/editor-icons/play.png" [(+ x 2) (+ y 4)] [16 16])
      (text [(+ x 6) (+ y 4)] "?"))
    (region id label origin size)
    (or (activated? id) (and (pointer-pressed?) (hit? origin size)))))

; A visible pane folds into a rail without changing its visibility or content.
(defn ui-pane-toggle [id key caption x y width right]
  (let [collapsed (get key) origin [x y] size [width 36]
        points-right (if collapsed (not right) right)
        tip (+ x (if points-right 22 16)) tail (+ x (if points-right 16 22))]
    (fill (if (or (hit? origin size) (focused? id)) "#252e29" (get :ui-panel)))
    (rect origin size)
    (fill (get :ui-text))
    (line [tail (+ y 12)] [tip (+ y 18)] 2)
    (line [tip (+ y 18)] [tail (+ y 24)] 2)
    (when (> width 80) (text [(+ x 36) (+ y 12)] caption))
    (region id (str (if collapsed "Expand " "Collapse ") caption) origin size)
    (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
      (set! key (not collapsed)))))
