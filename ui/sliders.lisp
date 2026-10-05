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
      (fill "#303932")
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
