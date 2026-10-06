; WISP TRAILS — the previous canvas carries a little ghost's fading echoes.
; previous-pixel returns RGBA; alpha distinguishes fresh history from a frame.
(init! :trail-decay 0.96 ["Trail retention" 0.7 0.995 0.005])
(init! :trail-radius 10 ["Spirit size" 2 32 1])
(init! :trail-color "#c4dfd1" ["Spirit color"])
(init! :trail-clock 0)
(defn update [dt] (set! :trail-clock (+ (get :trail-clock) dt)))

(defdraw trail-spirit [x y radius] ["Wandering spirit" [160 120 10]]
  (scope
    (translate [x y]) (scale (/ radius 10))
    (fill (get :trail-color)) (circle [0 -3] 8) (rect [-8 -3] [16 10])
    (repeat 3 i (circle [(- (* i 5) 5) 7] 3))
    (fill "#20293a") (circle [-3 -3] 1.2) (circle [3 -3] 1.2)
    (line [-1 1] [1 1] 1)
    (fill "#d89bad") (circle [-5 0] 1.5) (circle [5 0] 1.5)))

(defdraw render []
  (pixels [p time]
    (let [old (previous-pixel p)
          shade (mix [0.055 0.07 0.11] old.xyz (* old.w (get :trail-decay)))]
      (rgba shade.x shade.y shade.z 1)))
  (let [w (canvas-width) h (canvas-height) t (get :trail-clock)]
    (fill "#d5dcc7") (circle [(* w 0.83) (* h 0.18)] 16)
    (fill "#0e121c") (circle [(+ (* w 0.83) 6) (- (* h 0.18) 4)] 15)
    (trail-spirit (+ (/ w 2) (* (/ w 3) (sin (* t 1.4))))
                  (+ (/ h 2) (* (/ h 3) (sin (* t 2.1)))) (get :trail-radius))
    (fill "#d5c5ed") (text [10 10] "WISP TRAILS")
    (fill "#b0b3bc") (text [10 (- h 16)] "little ghosts, little echoes")))
