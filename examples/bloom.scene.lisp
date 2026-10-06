; MOON BLOOM — additive petals, sleepy seed spirits and a mossy garden.
(init! :glow 0.55 ["Petal glow" 0 1 0.01])
(init! :accent "#d0ddd1" ["Flower face"])
(init! :moon 20 ["Flower center" 8 32 1])
(init! :petal-radius 17 ["Petal radius" 8 28 1])
(init! :bloom-speed 0.15 ["Bloom speed" 0 0.5 0.01])

(defdraw bloom-flower [] ["Sleepy moonflower"]
  (pixels [p time]
    (translate [(/ width 2) (/ height 2)])
    (scope
      (blend :add) (opacity (get :glow))
      (repeat 16 i
        (scope
          (rotate (+ (* i 0.3927) (* time (get :bloom-speed))))
          (fill (mix [0.32 0.22 0.42] [0.27 0.42 0.36] (/ i 16)))
          (circle [(+ 36 (* 6 (sin time))) 0]
                  (+ (get :petal-radius) (* 3 (sin (+ time i)))))))))
  (scope
    (translate [(/ (canvas-width) 2) (/ (canvas-height) 2)])
    (fill (get :accent)) (circle [0 0] (get :moon))
    (fill "#263040")
    (line [-9 -2] [-4 0] 1) (line [-4 0] [-1 -2] 1)
    (line [1 -2] [4 0] 1) (line [4 0] [9 -2] 1)
    (line [-2 7] [2 7] 1)
    (fill "#d695ad") (circle [-12 4] 3) (circle [12 4] 3)))

(init! :bloom-clock 0)
(defn update [dt] (set! :bloom-clock (+ (get :bloom-clock) dt)))

(defdraw render []
  (background "#101923")
  (let [w (canvas-width) h (canvas-height) time (get :bloom-clock)]
    (fill "#26323c") (rect [0 (- h 28)] [w 28])
    (fill "#698e7e") (rect [0 (- h 29)] [w 2])
    (repeat 5 i
      (let [x (* w (/ (+ i 0.5) 5)) y (- h 29)]
        (fill "#3a4352") (circle [x (- y 12)] 8) (rect [(- x 8) (- y 12)] [16 12])
        (fill "#7a8390") (line [(- x 3) (- y 9)] [(+ x 3) (- y 9)] 1)
        (line [x (- y 12)] [x (- y 6)] 1)))
    (fill "#698e7e") (rect [(- (/ w 2) 2) (/ h 2)] [4 (- (/ h 2) 29)])
    (bloom-flower)
    (repeat 9 i
      (let [x (+ (* w (/ (+ i 0.5) 9)) (* 4 (sin (+ time i))))
            y (+ (* h 0.35) (* 30 (sin (+ (* time 0.3) (* i 2)))))]
        (fill "#bbd8c8") (circle [x y] 3) (rect [(- x 3) y] [6 3])
        (fill "#263040") (circle [(- x 1) y] 0.6) (circle [(+ x 1) y] 0.6)))
    (fill "#d5c5ed") (text [10 10] "MOON BLOOM")
    (fill "#b0b3bc") (text [10 (- h 16)] "ghosts love moonflowers")))
