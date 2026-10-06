; TINY CRYPT — an original, asset-free Doom-style microgame.
; Play this scene, click the preview, then F4 for a bigger view.
; W/S or Up/Down: walk. A/D: strafe. Left/Right or Q/E: turn.
; Space: fire. R: restart. Clear three monsters, then find the green gate.
; GPU DDA raycasting, wall/floor/ceiling shading and sprite depth testing.

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
(init! :doom-bob-phase 0)
(init! :doom-moving false)
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
  (set! :doom-bob-phase 0) (set! :doom-moving false)
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
    (set! :doom-moving false)
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
        (set! :doom-moving (or (not (= forward 0)) (not (= strafe 0))))
        (when (get :doom-moving) (set! :doom-bob-phase (+ (get :doom-bob-phase) (* dt 9))))
        (set! :doom-angle (- (mod (+ a 3.14159) 6.28318) 3.14159))
        (when (doom-open? nx y) (set! :doom-x nx))
        (when (doom-open? (get :doom-x) ny) (set! :doom-y ny)))
      (when (and (key? " ") (= (get :doom-cooldown) 0)) (doom-fire))
      (doom-monsters dt)
      (when (and (= (get :doom-kills) 3) (> (get :doom-x) 8) (> (get :doom-y) 8))
        (set! :doom-won true) (play-sound "doom-victory")))))

; These draw hooks can also be inspected on their own in the editor.
(defdraw doom-weapon [] ["Pistol"]
  (scope
  (translate [(if (get :doom-moving) (* 2 (sin (get :doom-bob-phase))) 0)
              (+ (if (get :doom-moving) (* 2 (abs (cos (get :doom-bob-phase)))) 0)
                 (* 12 (max 0 (- (get :doom-cooldown) 0.12))))])
  (fill "#151a21") (rect [133 157] [54 54])
  (fill "#414952") (rect [142 153] [36 45])
  (fill "#899396") (rect [148 149] [24 30])
  (fill "#c4c8b6") (rect [151 148] [18 7])
  (fill "#20252d") (rect [154 162] [12 25])
  (when (> (get :doom-cooldown) 0.19)
    (fill "#ffbd55") (circle [160 145] 15)
    (fill "#fff2b0") (circle [160 145] 7))))
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

; Three projected quads, sorted far-to-near. Each sprite pixel traces the map
; for exact wall occlusion instead of sharing a coarse CPU depth strip.
(defn doom-enemy-depth [i c s]
  (+ (* (- (get (doom-enemy-key i "-x")) (get :doom-x)) c)
     (* (- (get (doom-enemy-key i "-y")) (get :doom-y)) s)))
(defn doom-gpu-sprite [i c s]
  (let [z (doom-enemy-depth i c s) hp (get (doom-enemy-key i "-hp")) grid (doom-map)]
    (when (and (> hp 0) (> z 0.18))
      (let [dx (- (get (doom-enemy-key i "-x")) (get :doom-x))
            dy (- (get (doom-enemy-key i "-y")) (get :doom-y))
            focal (* (canvas-height) (/ 242.4242 240))
            half-width (/ (* focal 0.19) z)
            sx (+ (/ (canvas-width) 2) (* focal (/ (- (* dy c) (* dx s)) z)))
            h (/ (* (canvas-height) (/ 190 240)) z)
            top (- (+ (* (canvas-height) (/ 100 240)) (/ (* focal 0.5) z)) h)
            view-bottom (* (canvas-height) (/ 210 240))]
        (scope
          (clip [(max 0 (- sx half-width)) (max 0 top)]
                [(max 0 (- (min (canvas-width) (+ sx half-width)) (max 0 (- sx half-width))))
                 (max 0 (- (min view-bottom (+ top h)) (max 0 top)))])
          (pixels [p time]
            (let [camera (/ (- (+ p.x 0.5) (/ width 2)) (* height (/ 242.4242 240)))
                  ray [(- c (* s camera)) (+ s (* c camera))]
                  wall (grid-ray [(get :doom-x) (get :doom-y)] ray grid)
                  edge (abs (/ (- (+ p.x 0.5) sx) h)) v (/ (- p.y top) h)
                  body (* (step 0.27 v) (- 1 (step 0.87 v)))
                  coat (* (step 0.31 v) (- 1 (step 0.81 v)) (- 1 (step 0.21 edge)))
                  head (* (- 1 (step 0.14 edge)) (- 1 (step 0.3 v)))
                  eyes (* head (step 0.05 edge) (- 1 (step 0.12 edge))
                          (step 0.12 v) (- 1 (step 0.165 v)))
                  feet (* (step 0.05 edge) (- 1 (step 0.18 edge)) (step 0.8 v))
                  shade (/ 1 (+ 1 (* z 0.1)))
                  cloth (mix [0.48 0.22 0.28] [0.75 0.25 0.2] (- 1 (step 1.5 hp)))
                  color (mix (mix (mix [0.16 0.12 0.16] cloth coat) [0.7 0.52 0.35] head) [0.19 0.16 0.2] feet)
                  lit (mix (* color shade) [1 0.86 0.46] eyes)
                  visible (* (- 1 (step wall.x z)) (max body (max head feet)))]
              (background (rgba lit.x lit.y lit.z visible)))))))))
(defn doom-label [x y size value]
  (scope (translate [x y]) (scale size) (text [0 0] value)))
(defdraw render []
  (background "#10141a")
  (clip [0 0] [(canvas-width) (canvas-height)])
  (let [c (cos (get :doom-angle)) s (sin (get :doom-angle)) grid (doom-map)]
    ; Every canvas column gets a precise GPU ray; larger canvases add detail.
    ; Projection is based on height, so wider canvases increase the field of view.
    (pixels [p time]
      (let [focal (* height (/ 242.4242 240)) horizon (* height (/ 100 240))
            distance (/ (* focal 0.5) (max 0.75 (abs (- p.y horizon))))
            camera (/ (- (+ p.x 0.5) (/ width 2)) focal)
            ray [(- c (* s camera)) (+ s (* c camera))]
            hit (grid-ray [(get :doom-x) (get :doom-y)] ray grid)
            wall-distance (max 0.08 hit.x) h (/ focal wall-distance)
            top (- horizon (* h 0.5)) v (/ (- p.y top) h)
            wall-mask (* (step top p.y) (- 1 (step (+ top h) p.y)))
            wall-u (mix (+ (get :doom-y) (* wall-distance ray.y))
                        (+ (get :doom-x) (* wall-distance ray.x)) hit.y)
            row (floor (* v 6)) brick (fract (+ (* wall-u 4) (* (mod row 2) 0.5)))
            wall-mortar (max (- 1 (step 0.055 brick)) (step 0.93 (fract (* v 6))))
            wall-grain (noise [(floor (* wall-u 96)) (floor (* v 96))])
            wall-shade (/ (mix 0.82 0.62 hit.y) (+ 1 (* wall-distance 0.16)))
            wall-base (mix [0.66 0.62 0.56] [0.24 0.85 0.4] (step 1.5 hit.z))
            wall-color (* wall-base wall-shade (+ 0.88 (* wall-grain 0.12)) (- 1 (* wall-mortar 0.55)))
            wx (+ (get :doom-x) (* distance (- c (* s camera))))
            wy (+ (get :doom-y) (* distance (+ s (* c camera))))
            floor-side (step horizon p.y)
            tile (+ (* wx 2) (* (mod (floor (* wy 2)) 2) 0.5))
            mortar (max (- 1 (step 0.04 (fract tile))) (- 1 (step 0.05 (fract (* wy 2)))))
            grain (noise [(floor (* wx 48)) (floor (* wy 48))])
            shade (/ 1 (+ 0.25 (* distance 0.13)))
            stone (mix [0.16 0.19 0.23] [0.32 0.28 0.24] floor-side)
            color (* stone shade (+ 0.85 (* grain 0.15)) (- 1 (* mortar 0.55)))]
        (background (mix color wall-color wall-mask))))
    (mapv (fn [i] (doom-gpu-sprite i c s))
      (sort [0 1 2] (fn [a b] (- (doom-enemy-depth b c s) (doom-enemy-depth a c s))))))
  (fill "#e5dfb1")
  (line [(- (/ (canvas-width) 2) 5) (* (canvas-height) (/ 100 240))]
        [(+ (/ (canvas-width) 2) 5) (* (canvas-height) (/ 100 240))] 1)
  (line [(/ (canvas-width) 2) (- (* (canvas-height) (/ 100 240)) 5)]
        [(/ (canvas-width) 2) (+ (* (canvas-height) (/ 100 240)) 5)] 1)
  (let [hud-scale (min (/ (canvas-width) 320) (/ (canvas-height) 240))]
  (scope (translate [(- (canvas-width) (* 320 hud-scale)) 0]) (scale hud-scale) (doom-minimap))
  (scope
  (translate [(/ (- (canvas-width) (* 320 hud-scale)) 2) (- (canvas-height) (* 240 hud-scale))])
  (scale hud-scale)
  (doom-weapon)))
  ; Text stays at native or integer-multiple size, independently of world/HUD
  ; geometry. Fractional shrinking destroys glyphs before the preview scales up.
  (let [font-scale (max 1 (floor (min (/ (canvas-width) 320) (/ (canvas-height) 240))))
        hud-height (* 44 font-scale) hud-y (- (canvas-height) hud-height)
        left (* 8 font-scale) row1 (+ hud-y (* 4 font-scale)) row2 (+ hud-y (* 24 font-scale))]
  (fill "#111820") (rect [0 hud-y] [(canvas-width) hud-height])
  (fill "#e1d1ad") (doom-label left row1 font-scale "TINY CRYPT")
  (fill (if (< (get :doom-health) 30) "#ef7c67" "#e1d1ad"))
  (doom-label (- (canvas-width) (* 192 font-scale)) row1 font-scale (str "HP " (get :doom-health)))
  (fill "#e1d1ad")
  (doom-label (- (canvas-width) (* 104 font-scale)) row1 font-scale (str "KILLS " (get :doom-kills) "/3"))
  (fill "#a6b8b2") (doom-label left row2 font-scale "WASD MOVE  ARROWS TURN  SPACE FIRE")
  (when (> (get :doom-hurt) 0.35)
    (fill "#b34848") (rect [0 0] [(canvas-width) 3]) (rect [0 (- hud-y 3)] [(canvas-width) 3]))
  (when (or (= (get :doom-health) 0) (get :doom-won))
    (let [panel-width (* 288 font-scale) panel-height (* 64 font-scale)
          x (floor (/ (- (canvas-width) panel-width) 2)) y (floor (/ (- hud-y panel-height) 2))]
      (fill "#10151d") (rect [x y] [panel-width panel-height])
      (fill "#ffe1a2") (doom-label (+ x (* 16 font-scale)) (+ y (* 10 font-scale)) font-scale
        (if (get :doom-won) "CRYPT CLEARED!" "YOU WERE EATEN"))
      (fill "#b6c6bd") (doom-label (+ x (* 16 font-scale)) (+ y (* 36 font-scale)) font-scale "PRESS R TO RESTART")))))
