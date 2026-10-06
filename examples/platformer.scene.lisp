; POCKET PEAKS — an original, asset-free side-scrolling platformer.
; A/D or arrows move. Space/W/Up jump; release early for a short hop.
; Hold X to run. R restarts. Collect coins, bump gold blocks and stomp slimes.
; The blue checkpoint saves your progress through the level; reach the flag!
; Collision uses 16-pixel tiles and four small physics steps per frame.

(init! :peak-x 32)
(init! :peak-y 192)
(init! :peak-vx 0)
(init! :peak-vy 0)
(init! :peak-grounded true)
(init! :peak-speed 112 ["Walk speed" 60 150 1])
(init! :peak-jump 300 ["Jump strength" 160 340 1])
(init! :peak-gravity 650 ["Gravity" 400 900 10])
(init! :peak-camera 0)
(init! :peak-clock 0)
(init! :peak-lives 3)
(init! :peak-coins 0)
(init! :peak-collected [])
(init! :peak-used-blocks [])
(init! :peak-checkpoint false)
(init! :peak-won false)
(init! :peak-over false)
(init! :peak-jump-held false)
(init! :peak-reset-held false)
(init! :peak-coyote 0.1)
(init! :peak-buffer 0)
(init! :peak-invincible 0)
(init! :peak-facing 1)
(repeat 4 i
  (init! (str "peak-slime-" i "-x") (nth [256 464 864 1184] i))
  (init! (str "peak-slime-" i "-dir") 1)
  (init! (str "peak-slime-" i "-alive") true))

(defn peak-slime-key [i suffix] (str "peak-slime-" i suffix))
(defn peak-coins []
  [[96 174] [144 142] [208 110] [240 110] [368 126] [416 126]
   [544 142] [608 174] [760 126] [824 126] [1072 142] [1152 174]])

; 1 earth, 2 brick, 3 coin block, 4 used block. The level is 82 tiles long.
(defn peak-tile [x y]
  (if (or (< x 0) (>= x 82)) 1
    (if (and (>= y 13) (< y 15)
          (or (< x 18) (and (>= x 21) (< x 40))
              (and (>= x 43) (< x 62)) (>= x 65))) 1
      (if (or (and (= y 10) (= x 9)) (and (= y 9) (= x 26)) (and (= y 10) (= x 70)))
        (if (contains? (get :peak-used-blocks) (str x ":" y)) 4 3)
        (if (or (and (= y 10) (>= x 8) (<= x 11))
                (and (= y 8) (>= x 13) (<= x 16))
                (and (= y 9) (>= x 25) (<= x 28))
                (and (= y 10) (>= x 34) (<= x 37))
                (and (= y 9) (>= x 47) (<= x 51))
                (and (= y 10) (>= x 69) (<= x 72))) 2 0)))))
(defn peak-solid? [x y] (> (peak-tile (floor (/ x 16)) (floor (/ y 16))) 0))
(defn peak-collides? [x y]
  (or (peak-solid? x y) (peak-solid? (+ x 11.99) y)
      (peak-solid? x (+ y 15.99)) (peak-solid? (+ x 11.99) (+ y 15.99))))
(defn peak-overlap? [x y w h bx by bw bh]
  (and (< x (+ bx bw)) (> (+ x w) bx) (< y (+ by bh)) (> (+ y h) by)))
(defn peak-award-coin []
  (set! :peak-coins (+ (get :peak-coins) 1)) (play-sound "peak-coin"))
(defn peak-bump [x y]
  (let [col (floor (/ (+ x 6) 16)) row (floor (/ y 16))]
    (when (= (peak-tile col row) 3)
      (set! :peak-used-blocks (conj (get :peak-used-blocks) (str col ":" row)))
      (peak-award-coin))))
(defn peak-reset []
  (set! :peak-x 32) (set! :peak-y 192) (set! :peak-vx 0) (set! :peak-vy 0)
  (set! :peak-grounded true) (set! :peak-coyote 0.1) (set! :peak-buffer 0)
  (set! :peak-camera 0) (set! :peak-clock 0) (set! :peak-lives 3)
  (set! :peak-coins 0) (set! :peak-collected []) (set! :peak-used-blocks [])
  (set! :peak-checkpoint false) (set! :peak-won false) (set! :peak-over false)
  (set! :peak-invincible 0) (set! :peak-jump-held false) (set! :peak-facing 1)
  (repeat 4 i
    (set! (peak-slime-key i "-x") (nth [256 464 864 1184] i))
    (set! (peak-slime-key i "-dir") 1)
    (set! (peak-slime-key i "-alive") true)))
(defn enter [] (peak-reset))
(defn peak-take-hit [pit]
  (when (or pit (= (get :peak-invincible) 0))
    (set! :peak-lives (max 0 (- (get :peak-lives) 1)))
    (set! :peak-invincible 1.2) (play-sound "peak-hurt")
    (if (= (get :peak-lives) 0) (set! :peak-over true)
      (when pit
        (set! :peak-x (if (get :peak-checkpoint) 592 32)) (set! :peak-y 192)
        (set! :peak-vx 0) (set! :peak-vy 0) (set! :peak-grounded true)))))

(defn peak-step [dt]
  (let [x (get :peak-x) vx (get :peak-vx) next (+ x (* vx dt))]
    (if (peak-collides? next (get :peak-y))
      (do (set! :peak-x (if (> vx 0) (- (* 16 (floor (/ (+ next 12) 16))) 12)
                          (* 16 (+ 1 (floor (/ next 16)))))) (set! :peak-vx 0))
      (set! :peak-x next)))
  (let [vy (min 420 (+ (get :peak-vy) (* (get :peak-gravity) dt)))
        next (+ (get :peak-y) (* vy dt))]
    (set! :peak-vy vy) (set! :peak-grounded false)
    (if (peak-collides? (get :peak-x) next)
      (do
        (if (> vy 0)
          (do (set! :peak-y (- (* 16 (floor (/ (+ next 16) 16))) 16))
              (set! :peak-grounded true) (set! :peak-coyote 0.1))
          (do (peak-bump (get :peak-x) next)
              (set! :peak-y (* 16 (+ 1 (floor (/ next 16)))))))
        (set! :peak-vy 0))
      (set! :peak-y next))))

(defn update [delta]
  (let [dt (min 0.05 delta) jump (or (key? " ") (key? "w") (key? "ArrowUp")) reset (key? "r")]
    (when (and reset (not (get :peak-reset-held))) (peak-reset))
    (set! :peak-reset-held reset)
    (set! :peak-clock (+ (get :peak-clock) dt))
    (when (and (not (get :peak-over)) (not (get :peak-won)))
      (set! :peak-invincible (max 0 (- (get :peak-invincible) dt)))
      (set! :peak-coyote (max 0 (- (get :peak-coyote) dt)))
      (set! :peak-buffer (max 0 (- (get :peak-buffer) dt)))
      (when (and jump (not (get :peak-jump-held))) (set! :peak-buffer 0.12))
      (when (and (not jump) (get :peak-jump-held) (< (get :peak-vy) -95)) (set! :peak-vy -95))
      (let [direction (- (if (or (key? "d") (key? "ArrowRight")) 1 0)
                          (if (or (key? "a") (key? "ArrowLeft")) 1 0))
            target (* direction (if (key? "x") 170 (get :peak-speed)))
            acceleration (* dt (if (= direction 0) 900 1100))
            old-bottom (+ (get :peak-y) 16)]
        (set! :peak-vx (+ (get :peak-vx) (clamp (- target (get :peak-vx)) (- acceleration) acceleration)))
        (when (not (= direction 0)) (set! :peak-facing direction))
        (when (and (> (get :peak-buffer) 0) (> (get :peak-coyote) 0))
          (set! :peak-vy (- (get :peak-jump))) (set! :peak-buffer 0) (set! :peak-coyote 0)
          (set! :peak-grounded false) (play-sound "peak-jump"))
        (repeat 4 step (peak-step (/ dt 4)))
        (repeat 4 i
          (when (get (peak-slime-key i "-alive"))
            (let [key (peak-slime-key i "-x") dir-key (peak-slime-key i "-dir")
                  lo (nth [224 416 816 1120] i) hi (nth [272 480 896 1200] i)
                  sx (+ (get key) (* (get dir-key) 28 dt))]
              (when (or (< sx lo) (> sx hi)) (set! dir-key (- (get dir-key))))
              (set! key (clamp sx lo hi))
              (when (peak-overlap? (get :peak-x) (get :peak-y) 12 16 (get key) 196 14 12)
                (if (and (> (get :peak-vy) 0) (<= old-bottom 202))
                  (do (set! (peak-slime-key i "-alive") false) (set! :peak-vy -150)
                      (set! :peak-grounded false) (play-sound "peak-stomp"))
                  (when (= (get :peak-invincible) 0)
                    (peak-take-hit false) (set! :peak-vy -120)
                    (set! :peak-vx (* -140 (get :peak-facing)))))))))
        (mapv (fn [i]
          (let [coin (nth (peak-coins) i)]
            (when (and (not (contains? (get :peak-collected) i))
              (peak-overlap? (get :peak-x) (get :peak-y) 12 16 (- (nth coin 0) 5) (- (nth coin 1) 5) 10 10))
              (set! :peak-collected (conj (get :peak-collected) i)) (peak-award-coin)))) (range 12))
        (when (and (not (get :peak-checkpoint)) (>= (get :peak-x) 592))
          (set! :peak-checkpoint true) (play-sound "peak-checkpoint"))
        (when (> (get :peak-y) 270) (peak-take-hit true))
        (when (and (>= (get :peak-x) 1248) (get :peak-grounded) (not (get :peak-over)))
          (set! :peak-won true) (play-sound "peak-win"))
        (set! :peak-camera (clamp (- (get :peak-x) 112) 0 992))))
    (set! :peak-jump-held jump)))

(defsound peak-jump [] ["Jump"] (voice :triangle 260 520 0.1 0.12))
(defsound peak-coin [] ["Coin"] (voice :sine 900 1400 0.1 0.12))
(defsound peak-stomp [] ["Stomp"] (voice :square 140 65 0.08 0.09))
(defsound peak-hurt [] ["Ouch"] (voice :sawtooth 180 60 0.15 0.1))
(defsound peak-checkpoint [] ["Checkpoint"] (voice :triangle 440 880 0.2 0.12))
(defsound peak-win [] ["Finish"]
  (voice :triangle 330 660 0.45 0.14) (voice :sine 660 990 0.45 0.08))

(defn peak-draw-tile [tile x y row]
  (fill (if (= tile 1) "#9e6749" (if (= tile 3) "#efb74d" (if (= tile 4) "#a88b73" "#cd7854"))))
  (rect [x y] [16 16])
  (fill (if (= tile 1) "#764c3e" "#995b4a"))
  (rect [x (+ y 15)] [16 1]) (rect [(+ x 15) y] [1 16])
  (if (= tile 1)
    (do
      (fill "#bd8a5b") (rect [(+ x 3) (+ y 8)] [4 2]) (rect [(+ x 10) (+ y 12)] [3 2])
      (when (= row 13) (fill "#67a85b") (rect [x y] [16 4])
        (fill "#b5d76d") (rect [x y] [16 1])))
    (do (fill "#f2b276") (rect [(+ x 1) (+ y 1)] [14 2])
      (when (= tile 3)
        (fill "#fff1bd") (rect [(+ x 5) (+ y 4)] [6 2]) (rect [(+ x 9) (+ y 6)] [2 3])
        (rect [(+ x 7) (+ y 8)] [4 2]) (rect [(+ x 7) (+ y 12)] [2 2])))))
(defn peak-draw-player [x y]
  (let [step (if (and (get :peak-grounded) (> (abs (get :peak-vx)) 8))
              (round (* 2 (sin (* (get :peak-clock) 18)))) 0)]
    (fill "#a65843") (rect [(+ x 1) y] [10 15])
    (fill "#ee9f4b") (rect [x y] [12 7])
    (fill "#ffe2b2") (rect [(+ x 3) (+ y 2)] [6 4])
    (fill "#34364f") (rect [(+ x (if (> (get :peak-facing) 0) 7 3)) (+ y 3)] [2 2])
    (fill "#438a91") (rect [(+ x 2) (+ y 7)] [8 6])
    (fill "#e16679") (rect [(- x 2) (+ y 7)] [10 2])
    (fill "#34364f") (rect [(+ x 1) (+ y 13 step)] [4 3])
    (rect [(+ x 7) (+ y 13 (- step))] [4 3])))
(defn peak-flag [x checkpoint]
  (fill "#faf0c9") (rect [x 160] [2 48])
  (fill (if checkpoint (if (get :peak-checkpoint) "#45b9b0" "#829898") "#e16679"))
  (rect [(+ x 2) 160] [16 11])
  (fill "#faf0c9") (rect [(+ x 6) 163] [5 5]))

(defdraw render []
  (background "#34364f")
  (let [zoom (min (/ (canvas-width) 320) (/ (canvas-height) 240))
        cam (round (get :peak-camera)) clock (get :peak-clock)]
    (scope
      (translate [(/ (- (canvas-width) (* 320 zoom)) 2) (/ (- (canvas-height) (* 240 zoom)) 2)])
      (scale zoom) (clip [0 0] [320 240])
      (pixels [p time]
        (background (mix [0.72 0.8 0.88] [1 0.84 0.68] (clamp (/ p.y 200) 0 1))))
      (fill "#ffe9ab") (circle [254 62] 22)
      (repeat 5 i
        (let [x (- (mod (- (+ (* i 91) 25 (* clock 3)) (* cam 0.12)) 410) 40)
              y (+ 45 (* (mod i 3) 18))]
          (fill "#fff2df") (circle [x y] 9) (circle [(+ x 12) (- y 3)] 12)
          (circle [(+ x 25) y] 9) (rect [x y] [25 8])))
      (repeat 6 i
        (fill "#a4b8bb") (circle [(- (mod (- (* i 90) (* cam 0.2)) 500) 80) 208] 75))
      (repeat 6 i
        (fill "#86a6a3") (circle [(- (mod (- (+ (* i 87) 20) (* cam 0.4)) 500) 70) 218] 48))
      (repeat 22 col
        (let [world (+ (floor (/ cam 16)) col) x (- (* world 16) cam)]
          (repeat 15 row
            (let [tile (peak-tile world row)]
              (when (> tile 0) (peak-draw-tile tile x (* row 16) row))))))
      (peak-flag (- 600 cam) true) (peak-flag (- 1260 cam) false)
      (repeat 12 i
        (when (not (contains? (get :peak-collected) i))
          (let [coin (nth (peak-coins) i) x (- (nth coin 0) cam)
                y (round (+ (nth coin 1) (* 2 (sin (+ (* clock 3) i))))) ]
            (fill "#bb7d3a") (circle [x (+ y 1)] 5)
            (fill "#f5ca67") (circle [x y] 4)
            (fill "#fff3bd") (rect [(- x 1) (- y 2)] [2 4]))))
      (repeat 4 i
        (when (get (peak-slime-key i "-alive"))
          (let [x (round (- (get (peak-slime-key i "-x")) cam))]
            (fill "#945370") (circle [(+ x 7) 201] 7)
            (fill "#d97c87") (rect [x 201] [14 7]) (circle [(+ x 7) 201] 6)
            (fill "#fff3d2") (rect [(+ x 3) 198] [3 3]) (rect [(+ x 9) 198] [3 3])
            (fill "#34364f") (rect [(+ x 4) 199] [2 2]) (rect [(+ x 10) 199] [2 2]))))
      (when (or (= (get :peak-invincible) 0) (= (mod (floor (* clock 12)) 2) 0))
        (peak-draw-player (round (- (get :peak-x) cam)) (round (get :peak-y)))))
  ; Full-size glyphs, independent of fractional sprite/world scaling.
  (let [font (max 1 (floor (min (/ (canvas-width) 320) (/ (canvas-height) 240))))
        bottom (- (canvas-height) (* 24 font))]
    (fill "#34364f") (rect [0 0] [(canvas-width) (* 24 font)])
    (rect [0 bottom] [(canvas-width) (* 24 font)])
    (scope (scale font)
      (fill "#ffe9ab") (text [8 4] "POCKET PEAKS")
      (fill "#f5ca67") (text [132 4] (str "COINS " (get :peak-coins)))
      (fill "#eeb2b6") (text [242 4] (str "HP " (get :peak-lives))))
    (scope (translate [(* 8 font) (+ bottom (* 4 font))]) (scale font)
      (fill "#e4d8d3") (text [0 0] "AD MOVE  SPACE JUMP  X RUN  R RESET"))
    (when (or (get :peak-over) (get :peak-won))
      (let [x (floor (/ (- (canvas-width) (* 256 font)) 2))
            y (floor (/ (- (canvas-height) (* 80 font)) 2))]
        (fill "#34364f") (rect [x y] [(* 256 font) (* 80 font)])
        (scope (translate [(+ x (* 16 font)) (+ y (* 10 font))]) (scale font)
          (fill "#ffe9ab") (text [0 0] (if (get :peak-won) "DELIVERY COMPLETE!" "TRY AGAIN, COURIER!"))
          (fill "#f5ca67") (text [0 24] (str "COINS " (get :peak-coins) "/15"))
          (fill "#e4d8d3") (text [0 48] "PRESS R TO RESTART")))))))
