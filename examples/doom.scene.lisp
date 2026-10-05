; TINY CRYPT — an original, asset-free Doom-style microgame.
; Play this scene, click the preview, then F4 for a bigger view.
; W/S or Up/Down: walk. A/D: strafe. Left/Right or Q/E: turn.
; Space: fire. R: restart. Clear three monsters, then find the green gate.
; CPU DDA raycasting + modular defdraw/defsound hooks, no host extensions.

(init! :doom-x 1.5 ["Player X" 1.2 8.8 0.1])
(init! :doom-y 1.5 ["Player Y" 1.2 8.8 0.1])
(init! :doom-angle 0 ["Facing radians" -3.14 3.14 0.05])
(init! :doom-speed 2.3 ["Walk speed" 0.5 5 0.1])
(init! :doom-turn 2.2 ["Turn speed" 0.5 4 0.1])
(init! :doom-health 100 ["Health" 0 100 1])
(init! :doom-kills 0)
(init! :doom-cooldown 0)
(init! :doom-hurt 0)
(init! :doom-won false)
(init! :doom-restart-held false)
(repeat 3 i
  (init! (str "doom-enemy-" i "-x") (nth [4.5 7.5 8.5] i))
  (init! (str "doom-enemy-" i "-y") (nth [1.5 4.5 7.5] i))
  (init! (str "doom-enemy-" i "-hp") 2))

; 1 = stone, 2 = solid green exit gate, 0 = open floor.
(defn doom-map []
  ["1111111111" "1000000001" "1001000001" "1001001001"
   "1000001001" "1000000001" "1011000001" "1000001001"
   "1000000002" "1111111111"])
(defn doom-tile [x y]
  (if (or (< x 0) (< y 0) (>= x 10) (>= y 10)) "1"
    (nth (nth (doom-map) (floor y)) (floor x))))
(defn doom-wall? [x y] (not (= (doom-tile x y) "0")))
(defn doom-open? [x y]
  (and (not (doom-wall? (- x 0.18) (- y 0.18)))
       (not (doom-wall? (+ x 0.18) (- y 0.18)))
       (not (doom-wall? (- x 0.18) (+ y 0.18)))
       (not (doom-wall? (+ x 0.18) (+ y 0.18)))))
(defn doom-enemy-key [i suffix] (str "doom-enemy-" i suffix))
(defn doom-reset []
  (set! :doom-x 1.5) (set! :doom-y 1.5) (set! :doom-angle 0)
  (set! :doom-health 100) (set! :doom-kills 0)
  (set! :doom-cooldown 0) (set! :doom-hurt 0) (set! :doom-won false)
  (repeat 3 i
    (set! (doom-enemy-key i "-x") (nth [4.5 7.5 8.5] i))
    (set! (doom-enemy-key i "-y") (nth [1.5 4.5 7.5] i))
    (set! (doom-enemy-key i "-hp") 2)))
(defn enter [] (doom-reset))

; Exact grid crossings: return [perpendicular distance, side, material].
; Guarded recursion keeps this ray walker inside the interpreter budget.
(defn doom-step-ray [gx gy tx ty dx dy sx sy steps]
  (if (= steps 0) [20 0 "1"]
    (if (< tx ty)
      (let [nx (+ gx sx) material (doom-tile nx gy)]
        (if (not (= material "0")) [tx 0 material]
          (doom-step-ray nx gy (+ tx dx) ty dx dy sx sy (- steps 1))))
      (let [ny (+ gy sy) material (doom-tile gx ny)]
        (if (not (= material "0")) [ty 1 material]
          (doom-step-ray gx ny tx (+ ty dy) dx dy sx sy (- steps 1)))))))
(defn doom-ray [rx ry]
  (let [x (get :doom-x) y (get :doom-y) gx (floor x) gy (floor y)
        dx (/ 1 (max 0.00001 (abs rx))) dy (/ 1 (max 0.00001 (abs ry)))
        sx (if (< rx 0) -1 1) sy (if (< ry 0) -1 1)
        tx (* dx (if (< rx 0) (- x gx) (- (+ gx 1) x)))
        ty (* dy (if (< ry 0) (- y gy) (- (+ gy 1) y)))]
    (doom-step-ray gx gy tx ty dx dy sx sy 24)))

(defsound doom-pistol [] ["Pistol"]
  (voice :noise 900 60 0.12 0.18)
  (voice :square 150 40 0.1 0.13))
(defsound doom-hit [] ["Monster hit"]
  (voice :sawtooth 180 55 0.16 0.12))
(defsound doom-victory [] ["Exit fanfare"]
  (voice :triangle 330 660 0.5 0.2)
  (voice :sine 495 990 0.5 0.1))
; Default sound keeps the ordinary audio preview useful too.
(defn sound [] (doom-pistol))

(defn doom-target [i depth best c s]
  (if (= i 3) best
    (let [dx (- (get (doom-enemy-key i "-x")) (get :doom-x))
          dy (- (get (doom-enemy-key i "-y")) (get :doom-y))
          z (+ (* dx c) (* dy s)) side (- (* dy c) (* dx s))
          hit (and (> (get (doom-enemy-key i "-hp")) 0) (> z 0) (< z depth) (< (abs side) 0.3))]
      (doom-target (+ i 1) (if hit z depth) (if hit i best) c s))))
(defn doom-fire []
  (set! :doom-cooldown 0.28)
  (play-sound "doom-pistol")
  (let [a (get :doom-angle) c (cos a) s (sin a)
        target (doom-target 0 (nth (doom-ray c s) 0) -1 c s)]
    (when (>= target 0)
      (let [key (doom-enemy-key target "-hp")]
        (set! key (- (get key) 1))
        (play-sound "doom-hit")
        (when (= (get key) 0) (set! :doom-kills (+ (get :doom-kills) 1)))))))

(defn doom-monsters [dt]
  (repeat 3 i
    (when (> (get (doom-enemy-key i "-hp")) 0)
      (let [kx (doom-enemy-key i "-x") ky (doom-enemy-key i "-y")
            x (get kx) y (get ky) dx (- (get :doom-x) x) dy (- (get :doom-y) y)
            distance (+ (* dx dx) (* dy dy))]
        (when (and (< distance 25) (> distance 0.38))
          ; Only chase with line of sight. Collision slides along wall edges.
          (when (> (nth (doom-ray (- dx) (- dy)) 0) 0.95)
            (let [step (/ (* dt 0.5) (max 1 (+ (abs dx) (abs dy))))
                  nx (+ x (* dx step)) ny (+ y (* dy step))]
              (when (doom-open? nx y) (set! kx nx))
              (when (doom-open? (get kx) ny) (set! ky ny)))))
        (when (and (< distance 0.55) (= (get :doom-hurt) 0))
          (set! :doom-health (max 0 (- (get :doom-health) 12)))
          (set! :doom-hurt 0.6))))))
(defn update [delta]
  (let [dt (min delta 0.05) restart (or (key? "r") (key? "R"))]
    (when (and restart (not (get :doom-restart-held))) (doom-reset))
    (set! :doom-restart-held restart)
    (set! :doom-cooldown (max 0 (- (get :doom-cooldown) dt)))
    (set! :doom-hurt (max 0 (- (get :doom-hurt) dt)))
    (when (and (> (get :doom-health) 0) (not (get :doom-won)))
      (let [turn (- (if (or (key? "ArrowRight") (key? "e")) 1 0)
                    (if (or (key? "ArrowLeft") (key? "q")) 1 0))
            forward (- (if (or (key? "w") (key? "ArrowUp")) 1 0)
                       (if (or (key? "s") (key? "ArrowDown")) 1 0))
            strafe (- (if (key? "d") 1 0) (if (key? "a") 1 0))
            a (+ (get :doom-angle) (* turn (get :doom-turn) dt))
            step (/ (* dt (get :doom-speed)) (if (and (not (= forward 0)) (not (= strafe 0))) 1.4142 1))
            x (get :doom-x) y (get :doom-y)
            nx (+ x (* step (- (* forward (cos a)) (* strafe (sin a)))))
            ny (+ y (* step (+ (* forward (sin a)) (* strafe (cos a)))))]
        (set! :doom-angle (- (mod (+ a 3.14159) 6.28318) 3.14159))
        (when (doom-open? nx y) (set! :doom-x nx))
        (when (doom-open? (get :doom-x) ny) (set! :doom-y ny)))
      (when (and (key? " ") (= (get :doom-cooldown) 0)) (doom-fire))
      (doom-monsters dt)
      (when (and (= (get :doom-kills) 3) (> (get :doom-x) 8) (> (get :doom-y) 8))
        (set! :doom-won true) (play-sound "doom-victory")))))

; These draw hooks can also be inspected on their own in the editor.
(defdraw doom-weapon [] ["Pistol"]
  (fill "#151a21") (rect [133 157] [54 54])
  (fill "#414952") (rect [142 153] [36 45])
  (fill "#899396") (rect [148 149] [24 30])
  (fill "#c4c8b6") (rect [151 148] [18 7])
  (fill "#20252d") (rect [154 162] [12 25])
  (when (> (get :doom-cooldown) 0.19)
    (fill "#ffbd55") (circle [160 145] 15)
    (fill "#fff2b0") (circle [160 145] 7)))
(defdraw doom-minimap [] ["Minimap"]
  (fill "#10151d") (rect [262 6] [52 52])
  (repeat 10 y
    (repeat 10 x
      (fill (if (= (doom-tile x y) "2") "#8fe58a"
        (if (doom-wall? x y) "#73807d" "#252c33")))
      (rect [(+ 263 (* x 5)) (+ 7 (* y 5))] [4 4])))
  (repeat 3 i
    (when (> (get (doom-enemy-key i "-hp")) 0)
      (fill "#e66c59")
      (rect [(+ 262 (* 5 (get (doom-enemy-key i "-x"))))
             (+ 6 (* 5 (get (doom-enemy-key i "-y"))))] [3 3])))
  (fill "#ffe8a2")
  (circle [(+ 263 (* 5 (get :doom-x))) (+ 7 (* 5 (get :doom-y)))] 2)
  (line [(+ 263 (* 5 (get :doom-x))) (+ 7 (* 5 (get :doom-y)))]
        [(+ 263 (* 5 (get :doom-x)) (* 4 (cos (get :doom-angle))))
         (+ 7 (* 5 (get :doom-y)) (* 4 (sin (get :doom-angle))))] 1))

; Sprite strips are depth-tested against walls and each other.
(defn doom-nearest-sprite [i column depth best c s]
  (if (= i 3) [best depth]
    (let [dx (- (get (doom-enemy-key i "-x")) (get :doom-x))
          dy (- (get (doom-enemy-key i "-y")) (get :doom-y))
          z (+ (* dx c) (* dy s))
          visible (and (> (get (doom-enemy-key i "-hp")) 0) (> z 0.18) (< z depth))
          hit (if visible
            (< (abs (- column (+ 160 (* 242 (/ (- (* dy c) (* dx s)) z))))) (/ 39 z)) false)]
      (doom-nearest-sprite (+ i 1) column (if hit z depth) (if hit i best) c s))))
(defn doom-sprite [column wall c s]
  (let [sprite (doom-nearest-sprite 0 column wall -1 c s) i (nth sprite 0)]
    (when (>= i 0)
      (let [z (nth sprite 1) h (/ 150 z) top (- 100 (* h 0.45))
            dx (- (get (doom-enemy-key i "-x")) (get :doom-x))
            dy (- (get (doom-enemy-key i "-y")) (get :doom-y))
            sx (+ 160 (* 242 (/ (- (* dy c) (* dx s)) z))) local (/ (- column sx) h)]
        (fill (if (= (get (doom-enemy-key i "-hp")) 1) "#cc6354" "#864a55"))
        (rect [(- column 4) (+ top (* h 0.2))] [8 (* h 0.7)])
        (fill "#bb785c") (rect [(- column 4) top] [8 (* h 0.32)])
        (fill "#ffe198")
        (when (> (abs local) 0.07)
          (rect [(- column 4) (+ top (* h 0.12))] [8 (* h 0.06)]))
        (fill "#392c39")
        (rect [(- column 4) (+ top (* h 0.87))] [8 (* h 0.08)])))))
(defn doom-label [x y size value]
  (scope (translate [x y]) (scale size) (text [0 0] value)))
(defn draw []
  (clip [0 0] [320 240])
  (fill "#181e2d") (rect [0 0] [320 100])
  (fill "#303137") (rect [0 100] [320 110])
  (repeat 6 i
    (fill [(+ 0.12 (* i 0.012)) (+ 0.12 (* i 0.01)) (+ 0.14 (* i 0.009))])
    (rect [0 (+ 100 (* i 18))] [320 18]))
  (let [c (cos (get :doom-angle)) s (sin (get :doom-angle))]
    (repeat 40 i
      (let [column (+ 4 (* i 8)) camera (* 0.66 (- (/ column 160) 1))
            rx (- c (* s camera)) ry (+ s (* c camera)) hit (doom-ray rx ry)
            distance (max 0.08 (nth hit 0)) h (/ 190 distance)
            top (- 100 (* h 0.5)) shade (/ (if (= (nth hit 1) 0) 0.82 0.62) (+ 1 (* distance 0.16)))
            u (mod (if (= (nth hit 1) 0) (+ (get :doom-y) (* distance ry))
                    (+ (get :doom-x) (* distance rx))) 1)]
        (fill (if (= (nth hit 2) "2") [(* shade 0.3) shade (* shade 0.5)]
                [(* shade 0.68) (* shade 0.72) (* shade 0.77)]))
        (rect [(- column 4) top] [8 h])
        (fill [(* shade 0.25) (* shade 0.28) (* shade 0.32)])
        (repeat 4 row (rect [(- column 4) (+ top (* h (/ row 4)))] [8 (max 1 (* h 0.018))]))
        (when (< (mod (* u 4) 1) 0.15) (rect [(- column 4) top] [2 h]))
        (doom-sprite column distance c s))))
  (doom-weapon) (doom-minimap)
  (fill "#e5dfb1") (line [155 100] [165 100] 1) (line [160 95] [160 105] 1)
  (fill "#111820") (rect [0 210] [320 30])
  (fill "#e1d1ad") (doom-label 8 210 0.7 "TINY CRYPT")
  (fill (if (< (get :doom-health) 30) "#ef7c67" "#e1d1ad"))
  (doom-label 101 210 0.7 (str "HP " (get :doom-health) "   KILLS " (get :doom-kills) "/3"))
  (fill "#859591") (doom-label 8 224 0.6 "WASD MOVE  ARROWS TURN  SPACE FIRE")
  (when (> (get :doom-hurt) 0.35)
    (fill "#b34848") (rect [0 0] [320 3]) (rect [0 207] [320 3]))
  (when (or (= (get :doom-health) 0) (get :doom-won))
    (fill "#10151d") (rect [25 70] [270 58])
    (fill "#ffe1a2") (doom-label 62 76 1 (if (get :doom-won) "CRYPT CLEARED!" "YOU WERE EATEN"))
    (fill "#b6c6bd") (doom-label 80 104 0.75 "PRESS R TO RESTART")))

; The required pixel hook supplies the background; CPU draw overlays the world.
(defpixel render [p time] (background "#181e2d"))
