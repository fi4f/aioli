; WISP WEATHER — layered plasma fog and a small gathering of shy spirits.
; Inspect mist speed, glow and palette; all artwork stays procedural.
(init! :wind 0.6 ["Mist speed" 0 2 0.05])
(init! :glow 0.65 ["Wisp glow" 0 1 0.01])
(init! :accent "#c4dfd1" ["Spirit color"])
(init! :moon 18 ["Moon radius" 4 32 1])

(defdraw plasma-wisp [x y size] ["Shy spirit" [160 120 12]]
  (scope
    (translate [x y]) (scale (/ size 10))
    (scope (opacity (* 0.22 (get :glow)))
      (fill (get :accent)) (circle [0 0] 18))
    (fill (get :accent)) (circle [0 -3] 8) (rect [-8 -3] [16 10])
    (repeat 3 i (circle [(- (* i 5) 5) 7] 3))
    (fill "#22283b") (circle [-3 -3] 1.2) (circle [3 -3] 1.2)
    (line [-1 1] [1 1] 1)
    (fill "#d89bad") (circle [-5 0] 1.5) (circle [5 0] 1.5)))

(init! :plasma-clock 0)
(defn update [dt] (set! :plasma-clock (+ (get :plasma-clock) dt)))

(defdraw render []
  (pixels [p time]
    (let [uv (/ p [width height]) t (* time (get :wind))
          waves (+ (sin (+ (* uv.x 13) t)) (cos (- (* uv.y 17) t)))
          rings (sin (- (* (length (- uv [0.5 0.55])) 24) (* t 1.3)))
          fog (+ 0.5 (* 0.15 waves) (* 0.12 rings))]
      (background (mix [0.035 0.045 0.085] [0.24 0.18 0.32] fog))))
  (let [w (canvas-width) h (canvas-height) t (* (get :plasma-clock) (get :wind))]
    (fill "#d9d8ba") (circle [(* w 0.8) (* h 0.2)] (get :moon))
    (fill "#292239") (circle [(+ (* w 0.8) 7) (- (* h 0.2) 5)] (get :moon))
    (repeat 7 i
      (plasma-wisp (+ (* w (/ (+ i 0.5) 7)) (* 9 (sin (+ t i))))
                   (+ (* h (+ 0.48 (* 0.13 (sin (* i 2))))) (* 8 (cos (+ t i))))
                   (+ 7 (* 3 (sin (+ i t))))))
    (fill "#111b26")
    (repeat 12 i
      (rect [(* i (/ w 11)) (- h (+ 14 (* 7 (sin i))))] [3 24]))
    (fill "#d5c5ed") (text [10 10] "WISP WEATHER")
    (fill "#b0b3bc") (text [10 (- h 16)] "a quiet night for shy spirits")))
