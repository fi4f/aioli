; The entire previous canvas is available as RGBA inside pixels.
(init! :trail-decay 0.96 ["Trail retention" 0.7 0.995 0.005])
(init! :trail-radius 10 ["Brush radius" 2 32 1])
(init! :trail-color "#66d9ef" ["Brush color"])
(init! :trail-clock 0)
(defn update [dt] (set! :trail-clock (+ (get :trail-clock) dt)))
(defdraw render []
  (pixels [p time]
    (let [old (previous-pixel p) decay (get :trail-decay)]
      (rgba (* old.x decay) (* old.y decay) (* old.z decay) 1)))
  (let [w (canvas-width) h (canvas-height) t (get :trail-clock)]
    (fill (get :trail-color))
    (circle [(+ (/ w 2) (* (/ w 3) (sin (* t 1.4))))
             (+ (/ h 2) (* (/ h 3) (sin (* t 2.1))))] (get :trail-radius))))
