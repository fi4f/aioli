; MOON DASH — an original one-button rhythm runner, inspired by Geometry Dash.
; Space / Up / W / click starts and jumps. Hold to hop again on landing.
; R restarts immediately. Clear forty beats of spikes, blocks and gaps!
; Obstacles are [beat kind]. Tempo scales movement and gravity together.
(init! :dash-bpm 120 ["Tempo / BPM" 80 160 1])
(init! :dash-level [[4 "spike"] [6 "block"] [8 "double"] [11 "gap"]
  [14 "spike"] [16 "double"] [19 "block"] [22 "gap"] [25 "double"]
  [28 "spike"] [30 "block"] [33 "gap"] [36 "double"]] ["Obstacle chart"])
(init! :dash-distance 0)
(init! :dash-y 192)
(init! :dash-vy 0)
(init! :dash-grounded true)
(init! :dash-angle 0)
(init! :dash-clock 0)
(init! :dash-beat -1)
(init! :dash-running false)
(init! :dash-dead false)
(init! :dash-won false)
(init! :dash-attempt 1)
(init! :dash-best 0)
(init! :dash-reset-held false)
(defn dash-reset []
  (set! :dash-distance 0) (set! :dash-y 192) (set! :dash-vy 0)
  (set! :dash-grounded true) (set! :dash-angle 0) (set! :dash-clock 0)
  (set! :dash-beat -1) (set! :dash-running false) (set! :dash-dead false) (set! :dash-won false))
(defn enter [] (set! :dash-attempt 1) (set! :dash-best 0) (dash-reset))
(defn dash-progress [] (min 100 (floor (* 100 (/ (get :dash-distance) 2880)))))
(defn dash-die []
  (when (not (get :dash-dead))
    (set! :dash-dead true) (set! :dash-running false)
    (set! :dash-best (max (get :dash-best) (dash-progress))) (play-sound "dash-crash")))
(defn dash-gap? [x obstacles]
  (> (count (filter (fn [obstacle]
    (let [left (* (nth obstacle 0) 72)]
      (and (= (nth obstacle 1) "gap") (>= x left) (< x (+ left 52))))) obstacles)) 0))
(defn dash-spike-hit? [left]
  (let [x (+ (get :dash-distance) 67) y (+ (get :dash-y) 3)
        closest (clamp (+ left 11) x (+ x 10))
        top (- 208 (* 22 (- 1 (/ (abs (- closest (+ left 11))) 11))))]
    (and (< x (+ left 22)) (> (+ x 10) left) (> (+ y 10) top) (< y 208))))
(defn dash-step [dt ratio obstacles]
  (let [old-bottom (+ (get :dash-y) 16)]
    (set! :dash-distance (+ (get :dash-distance) (* 144 ratio dt)))
    (set! :dash-vy (+ (get :dash-vy) (* 1050 ratio ratio dt)))
    (set! :dash-y (+ (get :dash-y) (* (get :dash-vy) dt)))
    (set! :dash-grounded false)
    (when (and (<= old-bottom 208) (>= (get :dash-y) 192) (not (dash-gap? (+ (get :dash-distance) 72) obstacles)))
      (set! :dash-y 192) (set! :dash-vy 0) (set! :dash-grounded true))
    (mapv (fn [obstacle]
      (let [left (* (nth obstacle 0) 72) kind (nth obstacle 1) x (+ (get :dash-distance) 64)]
        (cond
          (= kind "spike") (when (dash-spike-hit? left) (dash-die))
          (= kind "double") (when (or (dash-spike-hit? left) (dash-spike-hit? (+ left 24))) (dash-die))
          (= kind "block")
            (when (and (< x (+ left 28)) (> (+ x 16) left))
              (if (and (>= (get :dash-vy) 0) (<= old-bottom 176) (>= (+ (get :dash-y) 16) 176))
                (do (set! :dash-y 160) (set! :dash-vy 0) (set! :dash-grounded true))
                (when (and (< (+ (get :dash-y) 3) 208) (> (+ (get :dash-y) 13) 176)
                  (< (+ x 3) (+ left 28)) (> (+ x 13) left)) (dash-die))))))) obstacles)
    (when (> (get :dash-y) 260) (dash-die))))
(defn update [delta]
  (let [dt (clamp delta 0 0.05) ratio (/ (get :dash-bpm) 120)
        jump (or (key? " ") (key? "ArrowUp") (key? "w") (pointer-down?) (pointer-pressed?)) reset (key? "r")]
    (when (and reset (not (get :dash-reset-held)))
      (set! :dash-best (max (get :dash-best) (dash-progress)))
      (set! :dash-attempt (+ (get :dash-attempt) 1)) (dash-reset))
    (set! :dash-reset-held reset)
    (when (and jump (not (get :dash-dead)) (not (get :dash-won)))
      (set! :dash-running true)
      (when (get :dash-grounded)
        (set! :dash-vy (* -330 ratio)) (set! :dash-grounded false) (play-sound "dash-jump")))
    (when (get :dash-running)
      (set! :dash-clock (+ (get :dash-clock) dt))
      (let [x (+ (get :dash-distance) 64)
            nearby (filter (fn [obstacle] (let [left (* (nth obstacle 0) 72)]
              (and (> left (- x 80)) (< left (+ x 80))))) (get :dash-level))]
        (repeat 4 step (when (not (get :dash-dead)) (dash-step (/ dt 4) ratio nearby))))
      (when (not (get :dash-grounded)) (set! :dash-angle (+ (get :dash-angle) (* dt ratio 10))))
      (when (get :dash-grounded) (set! :dash-angle (* 1.570796 (round (/ (get :dash-angle) 1.570796)))))
      (let [beat (floor (/ (get :dash-distance) 72))]
        (when (and (not (get :dash-dead)) (not (= beat (get :dash-beat))))
          (set! :dash-beat beat) (play-sound "dash-beat")))
      (when (and (not (get :dash-dead)) (>= (get :dash-distance) 2880))
        (set! :dash-won true) (set! :dash-running false) (set! :dash-best 100) (play-sound "dash-finish")))))
(defsound dash-jump [] ["Hop"] (voice :triangle 280 560 0.08 0.07))
(defsound dash-crash [] ["Oops"] (voice :triangle 180 50 0.22 0.12))
(defsound dash-beat [] ["Procedural beat"]
  (voice :sine (if (= (mod (get :dash-beat) 4) 0) 90 180) 55 0.07 0.07)
  (let [note (nth [330 440 392 494] (mod (max 0 (get :dash-beat)) 4))]
    (voice :triangle note note 0.12 0.035)))
(defsound dash-finish [] ["Finish"] (voice :triangle 440 880 0.4 0.12) (voice :sine 660 1320 0.3 0.05))
(defdraw dash-spike [x y] ["Spike" [140 208]]
  (fill "#d486b3")
  (repeat 11 i (rect [(+ x 10 (- i)) (+ y -22 (* i 2))] [(+ 2 (* i 2)) 2]))
  (fill "#f4d8e7") (rect [(+ x 10) (- y 20)] [2 5]))
(defdraw dash-cube [x y angle] ["Spinning runner" [64 192 0]]
  (pixels [p time]
    (scope (translate [(+ x 8) (+ y 8)]) (rotate angle)
      (fill "#97dbc5") (rect [-8 -8] [16 16])
      (fill "#d5f3d7") (rect [-6 -6] [12 2])
      (fill "#23404e") (rect [-5 -2] [3 4]) (rect [2 -2] [3 4]) (rect [-2 4] [4 1]))))
(defdraw dash-world [distance]
  (pixels [p time]
    (background (mix [0.05 0.07 0.14] [0.13 0.12 0.24] (clamp (/ p.y 240) 0 1)))
    (fill (rgba 0.6 0.65 0.9 (* 0.035 (noise (* p 0.15))))) (rect [0 0] [320 240]))
  (fill "#d6dcb5") (circle [268 57] 18)
  (fill "#131b30") (circle [276 52] 16)
  (repeat 18 i
    (fill "#8b91b3") (rect [(mod (- (+ (* i 43) 17) (* distance 0.08)) 320) (+ 35 (mod (* i 23) 100))] [1 1]))
  (repeat 8 i
    (fill "#222c45") (rect [(- (mod (- (* i 67) (* distance 0.25)) 420) 40) (+ 132 (* (mod i 3) 12))] [40 76]))
  (fill "#243b49") (rect [0 208] [320 32])
  (fill "#88bda9") (rect [0 208] [320 2])
  (repeat 13 i
    (let [x (- (* (+ (floor (/ distance 24)) i) 24) distance)]
      (fill "#344956") (rect [(+ x 2) 218] [20 1])))
  (mapv (fn [obstacle]
    (let [x (- (* (nth obstacle 0) 72) distance) kind (nth obstacle 1)]
      (when (and (> x -52) (< x 340))
        (cond (= kind "gap") (do (fill "#0b1224") (rect [x 208] [52 32]))
          (= kind "spike") (dash-spike x 208)
          (= kind "double") (do (dash-spike x 208) (dash-spike (+ x 24) 208))
          (= kind "block") (do (fill "#62719a") (rect [x 176] [28 32])
            (fill "#a9bee0") (rect [x 176] [28 2])
            (fill "#35435c") (rect [(+ x 5) 182] [18 20])
            (fill "#8497bf") (rect [(+ x 8) 186] [12 2])))))) (get :dash-level)))
(defdraw render []
  (background "#10182a")
  (let [zoom (min (/ (canvas-width) 320) (/ (canvas-height) 240))]
    (scope (translate [(/ (- (canvas-width) (* 320 zoom)) 2) (/ (- (canvas-height) (* 240 zoom)) 2)])
      (scale zoom) (clip [0 0] [320 240])
      (dash-world (get :dash-distance))
      (when (not (get :dash-dead)) (dash-cube 64 (get :dash-y) (get :dash-angle)))
      (fill "#111c30") (rect [0 0] [320 24]) (rect [0 216] [320 24])
      (fill "#d7dced") (text [8 4] "MOON DASH")
      (text [176 4] (str (dash-progress) "%  BEST " (get :dash-best) "%"))
      (fill "#33415d") (rect [8 28] [304 3])
      (fill "#97dbc5") (rect [8 28] [(* 304 (/ (dash-progress) 100)) 3])
      (fill "#aeb9ce") (text [8 220] "SPACE / CLICK JUMP   R RESTART")
      (when (or (get :dash-dead) (get :dash-won) (not (get :dash-running)))
        (fill "#26334d") (rect [32 80] [256 72])
        (fill "#d7dced") (text [48 88] (cond (get :dash-dead) "OOPS! ONE MORE TRY?" (get :dash-won) "FORTY BEATS CLEARED!" true "CHASE THE MOON"))
        (fill "#97dbc5") (text [48 110] (str "ATTEMPT " (get :dash-attempt) "   " (get :dash-bpm) " BPM"))
        (fill "#aeb9ce") (text [48 132] (if (or (get :dash-dead) (get :dash-won)) "R TO RESTART" "SPACE / CLICK TO START"))))))
