; ui/buttons.lisp / live Lisp drawing and interaction.
(defn ui-button [id caption origin size active]
  (scope
    (fill (if active (get :ui-accent)
              (if (or (hit? origin size) (focused? id)) (get :ui-hover) (get :ui-button))))
    (rect origin size)
    (fill (if active (get :ui-active-text) (get :ui-text)))
    (text [(+ (nth origin 0) 12) (+ (nth origin 1) 8)] caption))
  (region id caption origin size)
  (or (and (pointer-pressed?) (hit? origin size)) (activated? id)))

(defn ui-tab [id caption x active]
  (when (ui-button (str "tab-" id) caption [x 58] [70 32]
                   (= active id))
    (set! :tab id)))

; A compact pixel play glyph with a full accessible label.
(defn ui-run-button [id label x y]
  (let [origin [x y] size [(+ (get :ui-icon-size) 4) 24]]
    (fill (if (or (hit? origin size) (focused? id)) (get :ui-selection) (get :ui-panel)))
    (rect origin size)
    (fill (get :ui-accent))
    (if (icon-available? "editor/icon/play.png")
      (icon "editor/icon/play.png" [(+ x 2) (+ y 4)] [(get :ui-icon-size) (get :ui-icon-size)])
      (text [(+ x 6) (+ y 4)] "?"))
    (region id label origin size)
    (or (activated? id) (and (pointer-pressed?) (hit? origin size)))))

; A visible pane folds into a rail without changing its visibility or content.
(defn ui-pane-toggle [id key caption x y width right]
  (let [collapsed (get key) origin [x y] size [width 36]
        points-right (if collapsed (not right) right)]

    (fill (if (or (hit? origin size) (focused? id)) (get :ui-hover) (get :ui-panel)))
    (rect origin size)
    (fill (get :ui-text))
    (ui-chevron (if points-right "r" "l") (+ x 12) (+ y 10) (get :ui-icon-size))
    (when (> width 80) (text [(+ x 36) (+ y 12)] caption))
    (region id (str (if collapsed "Expand " "Collapse ") caption) origin size)
    (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
      (set! key (not collapsed)))))


; Directional artwork is an ordinary theme-tinted PNG resource.
(defn ui-chevron [direction x y size]
  (let [path (str "editor/icon/chevron-" direction ".png")]
    (if (icon-available? path)
      (icon path [x y] [size size])
      (text [x y] "?"))))
(defn ui-icon-button [id label path origin size]
  (scope
    (fill (if (or (hit? origin size) (focused? id)) (get :ui-hover) (get :ui-button)))
    (rect origin size)
    (fill (get :ui-text))
    (let [glyph (min (get :ui-icon-size) (- (nth size 0) 4) (- (nth size 1) 4))]
      (let [position [(+ (nth origin 0) (/ (- (nth size 0) glyph) 2))
                      (+ (nth origin 1) (/ (- (nth size 1) glyph) 2))]]
        (if (icon-available? path) (icon path position [glyph glyph]) (text position "?")))))
  (region id label origin size)
  (or (activated? id) (and (pointer-pressed?) (hit? origin size))))

(defn ui-chevron-button [id label direction origin size]
  (ui-icon-button id label (str "editor/icon/chevron-" direction ".png") origin size))
(defn ui-close-button [id label origin size]
  (ui-icon-button id label "editor/icon/x.png" origin size))
