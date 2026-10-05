; ui/sliders.lisp / live Lisp drawing and interaction.
(defn ui-slider [id caption key x y width low high]
  (scope
    (fill (get :ui-muted))
    (text [x y] caption)
    (text [(+ x width -48) y] (str (round (* (get key) 100)) "%"))
    (let [origin [x (+ y 28)] size [width 18]]
      (region id caption origin size key low high)
      (when (and (pointer-pressed?) (hit? origin size))
        (capture! id))
      (when (and (or (pointer-down?) (pointer-pressed?)) (captured? id))
        (set! key (clamp (+ low (* (/ (- (pointer-x) x) width)
                                 (- high low))) low high)))
      (fill (get :ui-slider-track))
      (rect [x (+ y 35)] [width 2])
      (fill (get :ui-accent))
      (rect [x (+ y 35)] [(* width (/ (- (get key) low)
                                      (- high low))) 2])
      (circle [(+ x (* width (/ (- (get key) low) (- high low))))
                (+ y 36)] 4))))

(defn ui-number-slider [id caption key x y width low high]
  (ui-slider id caption key x y width low high)
  ; Replace the value field with a number in this widget variant.
  (scope
    (fill (get :ui-panel))
    (rect [(+ x width -56) y] [56 20])
    (fill (get :ui-text))
    (text [(+ x width -48) y]
          (str (/ (round (* (get key) 100)) 100)))))

(defn ui-toggle [id caption key x y width]
  (when (ui-button id caption [x y] [width 32] (get key))
    (set! key (not (get key)))))

(defn ui-choice [id caption key choices x y width]
  (when (ui-button id (str caption " / " (get key)) [x y] [width 32] false)
    (repeat (count choices) i
      (when (= (get key) (nth choices i))
        (set! :choice-next (nth choices (mod (+ i 1) (count choices))))))
    (set! key (get :choice-next))))


; A pixel-scrolled inspector viewport with a draggable scrollbar and overflow arrows.
(defn ui-inspector-scroll [id key x y width height total]
  (let [limit (max 0 (- total height))
        offset (scroll-region id [x y] [width height] key limit)
        sx (+ x width -8) thumb (max 20 (* height (/ height (max height total))))
        travel (- height thumb) origin [(+ sx -4) y] size [12 height]]
    (when (> limit 0)
      (region (str id "-scrollbar") "Inspector scrollbar" origin size)
      (when (and (pointer-pressed?) (hit? origin size)) (capture! (str id "-scrollbar")))
      (when (and (pointer-down?) (captured? (str id "-scrollbar")))
        (set! key (* limit (clamp (/ (- (pointer-y) y (/ thumb 2)) (max 1 travel)) 0 1))))
      (fill (get :ui-muted))
      (rect [sx y] [2 height])
      (fill (get :ui-accent))
      (rect [(+ sx -2) (+ y (* travel (/ offset limit)))] [6 thumb]))
    (fill (get :ui-accent))
    (when (> offset 0)
      (ui-chevron "u" (+ x (/ width 2) -6) (- y 14) 12))
    (when (< offset limit)
      (ui-chevron "d" (+ x (/ width 2) -6) (+ y height 2) 12))
    offset))
