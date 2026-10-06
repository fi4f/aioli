; POCKET PEAKS — an original, asset-free side-scrolling platformer.
; A/D or arrows move. Space/W/Up jump; release early for a short hop.
; Hold X to run. R restarts. Collect lost lights, bump lantern blocks and boop mischievous ghosts.
; The blue lantern saves your progress; deliver the lights to the pink lantern!
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
  (init! (str "peak-ghost-" i "-x") (nth [256 464 864 1184] i))
  (init! (str "peak-ghost-" i "-dir") 1)
  (init! (str "peak-ghost-" i "-alive") true))

(defn peak-ghost-key [i suffix] (str "peak-ghost-" i suffix))
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
    (set! (peak-ghost-key i "-x") (nth [256 464 864 1184] i))
    (set! (peak-ghost-key i "-dir") 1)
    (set! (peak-ghost-key i "-alive") true)))
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
  (let [dt (clamp delta 0 0.05) jump (or (key? " ") (key? "w") (key? "ArrowUp")) reset (key? "r")]
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
          (when (get (peak-ghost-key i "-alive"))
            (let [key (peak-ghost-key i "-x") dir-key (peak-ghost-key i "-dir")
                  lo (nth [224 416 816 1120] i) hi (nth [272 480 896 1200] i)
                  sx (+ (get key) (* (get dir-key) 28 dt))]
              (when (or (< sx lo) (> sx hi)) (set! dir-key (- (get dir-key))))
              (set! key (clamp sx lo hi))
              (when (peak-overlap? (get :peak-x) (get :peak-y) 12 16 (get key) 196 14 12)
                (if (and (> (get :peak-vy) 0) (<= old-bottom 202))
                  (do (set! (peak-ghost-key i "-alive") false) (set! :peak-vy -150)
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


; Small inspectable drawables keep the scenery separate from the physics.
(defdraw peak-tombstone [x y] ["Sleepy tombstone" [50 208]]
  (fill "#273d47") (circle [(+ x 7) (- y 15)] 7) (rect [x (- y 15)] [14 15])
  (fill "#587176") (circle [(+ x 7) (- y 16)] 6) (rect [(+ x 1) (- y 16)] [12 15])
  (fill "#80968c") (rect [(+ x 3) (- y 17)] [8 2])
  (fill "#324950") (rect [(+ x 5) (- y 12)] [4 1]) (rect [(+ x 5) (- y 9)] [4 1])
  (fill "#83b89d") (rect [(- x 2) (- y 2)] [18 2]))
(defdraw peak-ghost [x y color] ["Bashful ghost" [40 192 "#d5eadb"]]
  (fill "#24454d") (circle [(+ x 6) (+ y 6)] 6) (rect [x (+ y 6)] [12 8])
  (fill color) (circle [(+ x 6) (+ y 5)] 5) (rect [(+ x 1) (+ y 5)] [10 8])
  (repeat 3 i (circle [(+ x 2 (* i 4)) (+ y 13)] 2))
  (fill "#203747") (rect [(+ x 3) (+ y 5)] [2 3]) (rect [(+ x 8) (+ y 5)] [2 3])
  (rect [(+ x 5) (+ y 10)] [2 1])
  (fill "#e3a1b2") (rect [(+ x 1) (+ y 8)] [2 1]) (rect [(+ x 9) (+ y 8)] [2 1]))
(defdraw peak-draw-player [x y] ["Ghost courier" [32 192]]
  (peak-ghost x y "#d5eadb")
  (fill "#ba83ab") (rect [(- x 2) (+ y 9)] [10 2])
  (fill "#f0cfa5") (rect [(+ x 8) (+ y 10)] [5 5])
  (fill "#94749b") (rect [(+ x 9) (+ y 11)] [3 1])
  (fill "#cce7b2") (rect [(+ x 3) (- y 2)] [3 2]))
(defdraw peak-flag [x checkpoint] ["Home lantern" [60 false]]
  (fill "#40555b") (rect [x 162] [2 46])
  (fill "#a0b7a4") (rect [(- x 4) 159] [10 2])
  (fill (if checkpoint (if (get :peak-checkpoint) "#87d4cc" "#657f8a") "#e4adc5"))
  (rect [(- x 3) 163] [8 12])
  (fill "#e6efba") (rect [(- x 1) 165] [4 7])
  (fill "#33494c") (rect [(- x 5) 175] [12 2]))
(defdraw peak-draw-tile [tile x y row]
  (fill (cond (= tile 1) "#263f43" (= tile 3) "#8b7894" (= tile 4) "#465967" true "#4d6570"))
  (rect [x y] [16 16])
  (fill "#1b3039") (rect [x (+ y 15)] [16 1]) (rect [(+ x 15) y] [1 16])
  (if (= tile 1)
    (do (fill "#385451") (rect [(+ x 3) (+ y 8)] [4 2]) (rect [(+ x 10) (+ y 12)] [3 2])
      (when (= row 13) (fill "#6b967b") (rect [x y] [16 3]) (fill "#a0b89b") (rect [x y] [16 1])))
    (do (fill "#81948c") (rect [(+ x 1) (+ y 1)] [14 2])
      (when (= tile 3) (fill "#e4e8ae") (rect [(+ x 5) (+ y 4)] [6 8])
        (fill "#7e647c") (rect [(+ x 7) (+ y 6)] [2 4])))))
(defdraw peak-background [cam clock]
  (pixels [p time]
    (background (mix [0.05 0.08 0.14] [0.1 0.17 0.23] (clamp (/ p.y 240) 0 1)))
    (fill (rgba 0.5 0.65 0.8 (* 0.045 (noise (* p 0.1))))) (rect [0 0] [320 240]))
  (fill "#d2e3ae") (circle [260 55] 21)
  (fill "#101d2c") (circle [269 49] 19)
  (repeat 22 i
    (let [x (mod (+ (* i 47) 13) 320) y (+ 30 (mod (* i 29) 100))]
      (fill "#6f879a") (rect [x y] [1 1])))
  (repeat 8 i
    (let [x (- (mod (- (* i 64) (* cam 0.2)) 440) 40)]
      (fill "#203640") (circle [x 205] 62)
      (fill "#182d39") (rect [(+ x 20) 114] [5 96])
      (line [(+ x 22) 152] [(+ x 6) 137] 3) (line [(+ x 22) 167] [(+ x 39) 143] 3)))
  (repeat 7 i
    (peak-tombstone (- (mod (- (+ (* i 61) 19) (* cam 0.45)) 410) 35) 208))
  (repeat 8 i
    (let [x (mod (+ (* i 43) (* clock 5) (- (* cam 0.35))) 320)
          y (+ 150 (* 10 (sin (+ clock i))))]
      (fill "#9bbf9b") (rect [x y] [2 2])))
  (fill "#2c4650") (rect [0 196] [320 6]))
(defdraw render []
  (background "#101b2b")
  (let [zoom (min (/ (canvas-width) 320) (/ (canvas-height) 240))
        cam (round (get :peak-camera)) clock (get :peak-clock)]
    (scope
      (translate [(/ (- (canvas-width) (* 320 zoom)) 2) (/ (- (canvas-height) (* 240 zoom)) 2)])
      (scale zoom) (clip [0 0] [320 240])
      (peak-background cam clock)
      (repeat 22 col
        (let [world (+ (floor (/ cam 16)) col) x (- (* world 16) cam)]
          (repeat 15 row
            (let [tile (peak-tile world row)]
              (when (> tile 0) (peak-draw-tile tile x (* row 16) row))))))
      (peak-flag (- 600 cam) true) (peak-flag (- 1260 cam) false)
      (repeat 12 i
        (when (not (contains? (get :peak-collected) i))
          (let [coin (nth (peak-coins) i) x (- (nth coin 0) cam)
                y (round (+ (nth coin 1) (* 2 (sin (+ (* clock 3) i)))))]
            (fill "#5d8079") (circle [x y] 5)
            (fill "#d9eab0") (circle [x y] 3)
            (fill "#f4edc9") (rect [(- x 1) (- y 1)] [2 2]))))
      (repeat 4 i
        (when (get (peak-ghost-key i "-alive"))
          (peak-ghost (round (- (get (peak-ghost-key i "-x")) cam)) 192 "#b19cc5")))
      (when (or (= (get :peak-invincible) 0) (= (mod (floor (* clock 12)) 2) 0))
        (peak-draw-player (round (- (get :peak-x) cam)) (round (get :peak-y)))))
  (let [font (max 1 (floor (min (/ (canvas-width) 320) (/ (canvas-height) 240))))
        bottom (- (canvas-height) (* 24 font))]
    (fill "#101b2b") (rect [0 0] [(canvas-width) (* 24 font)]) (rect [0 bottom] [(canvas-width) (* 24 font)])
    (scope (scale font)
      (fill "#d5eadb") (text [8 4] "MOONLIT MAIL")
      (fill "#d9eab0") (text [128 4] (str "LIGHTS " (get :peak-coins)))
      (fill "#e3a1b2") (text [248 4] (str "HP " (get :peak-lives))))
    (scope (translate [(* 8 font) (+ bottom (* 4 font))]) (scale font)
      (fill "#a9c1bd") (text [0 0] "AD MOVE  SPACE JUMP  X RUN  R RESET"))
    (when (or (get :peak-over) (get :peak-won))
      (let [x (floor (/ (- (canvas-width) (* 256 font)) 2)) y (floor (/ (- (canvas-height) (* 80 font)) 2))]
        (fill "#243944") (rect [x y] [(* 256 font) (* 80 font)])
        (scope (translate [(+ x (* 16 font)) (+ y (* 10 font))]) (scale font)
          (fill "#d5eadb") (text [0 0] (if (get :peak-won) "THE LIGHTS ARE HOME!" "TAKE A LITTLE GHOST NAP"))
          (fill "#d9eab0") (text [0 24] (str "LIGHTS " (get :peak-coins) "/15"))
          (fill "#a9c1bd") (text [0 48] "PRESS R TO RESTART")))))))
