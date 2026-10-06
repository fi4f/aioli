; BOO PATROL — an original, asset-free Doom-style microgame.
; Play this scene, click the preview, then F4 for a bigger view.
; W/S or Up/Down: walk. A/D: strafe. Left/Right or Q/E: turn.
; Space: shine your lantern. R: restart. Tuck in three ghosts, then find the moon gate.
; GPU DDA raycasting, wall/floor/ceiling shading and sprite depth testing.

(init! :boo-x 1.5 ["Player X" 1.2 8.8 0.1])
(init! :boo-y 1.5 ["Player Y" 1.2 8.8 0.1])
(init! :boo-angle 0 ["Facing radians" -3.14 3.14 0.05])
(init! :boo-speed 2.3 ["Walk speed" 0.5 5 0.1])
(init! :boo-turn 2.2 ["Turn speed" 0.5 4 0.1])
(init! :boo-health 100 ["Health" 0 100 1])
(init! :boo-kills 0)
(init! :boo-cooldown 0)
(init! :boo-hurt 0)
(init! :boo-won false)
(init! :boo-restart-held false)
(init! :boo-bob-phase 0)
(init! :boo-moving false)
(repeat 3 i
  (init! (str "boo-enemy-" i "-x") (nth [4.5 7.5 8.5] i))
  (init! (str "boo-enemy-" i "-y") (nth [1.5 4.5 7.5] i))
  (init! (str "boo-enemy-" i "-hp") 2))

; 1 = stone, 2 = solid moon exit gate, 0 = open floor.
(defn boo-map []
  ["1111111111" "1000000001" "1001000001" "1001001001"
   "1000001001" "1000000001" "1011000001" "1000001001"
   "1000000002" "1111111111"])
(defn boo-tile [x y]
  (if (or (< x 0) (< y 0) (>= x 10) (>= y 10)) "1"
    (nth (nth (boo-map) (floor y)) (floor x))))
(defn boo-wall? [x y] (not (= (boo-tile x y) "0")))
(defn boo-open? [x y]
  (and (not (boo-wall? (- x 0.18) (- y 0.18)))
       (not (boo-wall? (+ x 0.18) (- y 0.18)))
       (not (boo-wall? (- x 0.18) (+ y 0.18)))
       (not (boo-wall? (+ x 0.18) (+ y 0.18)))))
(defn boo-enemy-key [i suffix] (str "boo-enemy-" i suffix))
(defn boo-reset []
  (set! :boo-x 1.5) (set! :boo-y 1.5) (set! :boo-angle 0)
  (set! :boo-health 100) (set! :boo-kills 0)
  (set! :boo-cooldown 0) (set! :boo-hurt 0) (set! :boo-won false)
  (set! :boo-bob-phase 0) (set! :boo-moving false)
  (repeat 3 i
    (set! (boo-enemy-key i "-x") (nth [4.5 7.5 8.5] i))
    (set! (boo-enemy-key i "-y") (nth [1.5 4.5 7.5] i))
    (set! (boo-enemy-key i "-hp") 2)))
(defn enter [] (boo-reset))

; Exact grid crossings: return [perpendicular distance, side, material].
; Guarded recursion keeps this ray walker inside the interpreter budget.
(defn boo-step-ray [gx gy tx ty dx dy sx sy steps]
  (if (= steps 0) [20 0 "1"]
    (if (< tx ty)
      (let [nx (+ gx sx) material (boo-tile nx gy)]
        (if (not (= material "0")) [tx 0 material]
          (boo-step-ray nx gy (+ tx dx) ty dx dy sx sy (- steps 1))))
      (let [ny (+ gy sy) material (boo-tile gx ny)]
        (if (not (= material "0")) [ty 1 material]
          (boo-step-ray gx ny tx (+ ty dy) dx dy sx sy (- steps 1)))))))
(defn boo-ray [rx ry]
  (let [x (get :boo-x) y (get :boo-y) gx (floor x) gy (floor y)
        dx (/ 1 (max 0.00001 (abs rx))) dy (/ 1 (max 0.00001 (abs ry)))
        sx (if (< rx 0) -1 1) sy (if (< ry 0) -1 1)
        tx (* dx (if (< rx 0) (- x gx) (- (+ gx 1) x)))
        ty (* dy (if (< ry 0) (- y gy) (- (+ gy 1) y)))]
    (boo-step-ray gx gy tx ty dx dy sx sy 24)))

(defsound boo-lantern [] ["Moon lantern"]
  (voice :sine 880 440 0.18 0.18)
  (voice :triangle 1320 660 0.12 0.08))
(defsound boo-hit [] ["Sleepy chime"]
  (voice :sine 660 330 0.25 0.12))
(defsound boo-victory [] ["Exit fanfare"]
  (voice :triangle 330 660 0.5 0.2)
  (voice :sine 495 990 0.5 0.1))
; Default sound keeps the ordinary audio preview useful too.
(defn sound [] (boo-lantern))

(defn boo-target [i depth best c s]
  (if (= i 3) best
    (let [dx (- (get (boo-enemy-key i "-x")) (get :boo-x))
          dy (- (get (boo-enemy-key i "-y")) (get :boo-y))
          z (+ (* dx c) (* dy s)) side (- (* dy c) (* dx s))
          hit (and (> (get (boo-enemy-key i "-hp")) 0) (> z 0) (< z depth) (< (abs side) 0.3))]
      (boo-target (+ i 1) (if hit z depth) (if hit i best) c s))))
(defn boo-fire []
  (set! :boo-cooldown 0.28)
  (play-sound "boo-lantern")
  (let [a (get :boo-angle) c (cos a) s (sin a)
        target (boo-target 0 (nth (boo-ray c s) 0) -1 c s)]
    (when (>= target 0)
      (let [key (boo-enemy-key target "-hp")]
        (set! key (- (get key) 1))
        (play-sound "boo-hit")
        (when (= (get key) 0) (set! :boo-kills (+ (get :boo-kills) 1)))))))

(defn boo-monsters [dt]
  (repeat 3 i
    (when (> (get (boo-enemy-key i "-hp")) 0)
      (let [kx (boo-enemy-key i "-x") ky (boo-enemy-key i "-y")
            x (get kx) y (get ky) dx (- (get :boo-x) x) dy (- (get :boo-y) y)
            distance (+ (* dx dx) (* dy dy))]
        (when (and (< distance 25) (> distance 0.38))
          ; Only chase with line of sight. Collision slides along wall edges.
          (when (> (nth (boo-ray (- dx) (- dy)) 0) 0.95)
            (let [step (/ (* dt 0.5) (max 1 (+ (abs dx) (abs dy))))
                  nx (+ x (* dx step)) ny (+ y (* dy step))]
              (when (boo-open? nx y) (set! kx nx))
              (when (boo-open? (get kx) ny) (set! ky ny)))))
        (when (and (< distance 0.55) (= (get :boo-hurt) 0))
          (set! :boo-health (max 0 (- (get :boo-health) 12)))
          (set! :boo-hurt 0.6))))))
(defn update [delta]
  (let [dt (clamp delta 0 0.05) restart (or (key? "r") (key? "R"))]
    (set! :boo-moving false)
    (when (and restart (not (get :boo-restart-held))) (boo-reset))
    (set! :boo-restart-held restart)
    (set! :boo-cooldown (max 0 (- (get :boo-cooldown) dt)))
    (set! :boo-hurt (max 0 (- (get :boo-hurt) dt)))
    (when (and (> (get :boo-health) 0) (not (get :boo-won)))
      (let [turn (- (if (or (key? "ArrowRight") (key? "e")) 1 0)
                    (if (or (key? "ArrowLeft") (key? "q")) 1 0))
            forward (- (if (or (key? "w") (key? "ArrowUp")) 1 0)
                       (if (or (key? "s") (key? "ArrowDown")) 1 0))
            strafe (- (if (key? "d") 1 0) (if (key? "a") 1 0))
            a (+ (get :boo-angle) (* turn (get :boo-turn) dt))
            step (/ (* dt (get :boo-speed)) (if (and (not (= forward 0)) (not (= strafe 0))) 1.4142 1))
            x (get :boo-x) y (get :boo-y)
            nx (+ x (* step (- (* forward (cos a)) (* strafe (sin a)))))
            ny (+ y (* step (+ (* forward (sin a)) (* strafe (cos a)))))]
        (set! :boo-moving (or (not (= forward 0)) (not (= strafe 0))))
        (when (get :boo-moving) (set! :boo-bob-phase (+ (get :boo-bob-phase) (* dt 9))))
        (set! :boo-angle (- (mod (+ a 3.14159) 6.28318) 3.14159))
        (when (boo-open? nx y) (set! :boo-x nx))
        (when (boo-open? (get :boo-x) ny) (set! :boo-y ny)))
      (when (and (key? " ") (= (get :boo-cooldown) 0)) (boo-fire))
      (boo-monsters dt)
      (when (and (= (get :boo-kills) 3) (> (get :boo-x) 8) (> (get :boo-y) 8))
        (set! :boo-won true) (play-sound "boo-victory")))))

; These draw hooks can also be inspected on their own in the editor.
(defdraw boo-weapon [] ["Moon lantern"]
  (scope
  (translate [(if (get :boo-moving) (* 2 (sin (get :boo-bob-phase))) 0)
              (+ (if (get :boo-moving) (* 2 (abs (cos (get :boo-bob-phase)))) 0)
                 (* 12 (max 0 (- (get :boo-cooldown) 0.12))))])
  (fill "#34334c") (circle [160 157] 13)
  (fill "#101621") (circle [160 157] 9)
  (fill "#6b6383") (rect [143 161] [34 39])
  (fill "#bddccf") (rect [147 165] [26 27])
  (fill "#e5e4c4") (circle [160 178] 8)
  (fill "#46435c") (rect [143 192] [34 7]) (rect [158 163] [4 31])
  (when (> (get :boo-cooldown) 0.19)
    (scope (opacity 0.35) (fill "#d6f2d8") (circle [160 148] 24)))))
(defdraw boo-minimap [] ["Minimap"]
  (fill "#10151d") (rect [262 6] [52 52])
  (repeat 10 y
    (repeat 10 x
      (fill (if (= (boo-tile x y) "2") "#8fe58a"
        (if (boo-wall? x y) "#73807d" "#252c33")))
      (rect [(+ 263 (* x 5)) (+ 7 (* y 5))] [4 4])))
  (repeat 3 i
    (when (> (get (boo-enemy-key i "-hp")) 0)
      (fill "#c4a1df")
      (rect [(+ 262 (* 5 (get (boo-enemy-key i "-x"))))
             (+ 6 (* 5 (get (boo-enemy-key i "-y"))))] [3 3])))
  (fill "#ffe8a2")
  (circle [(+ 263 (* 5 (get :boo-x))) (+ 7 (* 5 (get :boo-y)))] 2)
  (line [(+ 263 (* 5 (get :boo-x))) (+ 7 (* 5 (get :boo-y)))]
        [(+ 263 (* 5 (get :boo-x)) (* 4 (cos (get :boo-angle))))
         (+ 7 (* 5 (get :boo-y)) (* 4 (sin (get :boo-angle))))] 1))

; Three projected quads, sorted far-to-near. Each sprite pixel traces the map
; for exact wall occlusion instead of sharing a coarse CPU depth strip.
(defn boo-enemy-depth [i c s]
  (+ (* (- (get (boo-enemy-key i "-x")) (get :boo-x)) c)
     (* (- (get (boo-enemy-key i "-y")) (get :boo-y)) s)))
(defn boo-gpu-sprite [i c s]
  (let [z (boo-enemy-depth i c s) hp (get (boo-enemy-key i "-hp")) grid (boo-map)]
    (when (and (> hp 0) (> z 0.18))
      (let [dx (- (get (boo-enemy-key i "-x")) (get :boo-x))
            dy (- (get (boo-enemy-key i "-y")) (get :boo-y))
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
                  wall (grid-ray [(get :boo-x) (get :boo-y)] ray grid)
                  edge (abs (/ (- (+ p.x 0.5) sx) h)) v (/ (- p.y top) h)
                  head (- 1 (step 0.19 (length [edge (- v 0.25)])))
                  skirt (* (- 1 (step 0.18 edge)) (step 0.25 v)
                           (- 1 (step (+ 0.73 (* 0.035 (cos (* edge 70)))) v)))
                  body (max head skirt)
                  eyes (* (step 0.045 edge) (- 1 (step 0.085 edge))
                          (step 0.23 v) (- 1 (step 0.29 v)))
                  mouth (* (- 1 (step 0.035 edge)) (step 0.35 v) (- 1 (step 0.375 v)))
                  cheeks (* (step 0.11 edge) (- 1 (step 0.155 edge))
                            (step 0.31 v) (- 1 (step 0.345 v)))
                  shade (/ 1 (+ 1 (* z 0.1)))
                  cloth (mix [0.7 0.8 0.78] [0.78 0.65 0.85] (- 1 (step 1.5 hp)))
                  color (mix cloth [0.86 0.59 0.69] cheeks)
                  lit (mix (* color shade) [0.12 0.14 0.22] (max eyes mouth))
                  visible (* (- 1 (step wall.x z)) body)]
              (background (rgba lit.x lit.y lit.z visible)))))))))
(defn boo-label [x y size value]
  (scope (translate [x y]) (scale size) (text [0 0] value)))
(defdraw render []
  (background "#10141a")
  (clip [0 0] [(canvas-width) (canvas-height)])
  (let [c (cos (get :boo-angle)) s (sin (get :boo-angle)) grid (boo-map)]
    ; Every canvas column gets a precise GPU ray; larger canvases add detail.
    ; Projection is based on height, so wider canvases increase the field of view.
    (pixels [p time]
      (let [focal (* height (/ 242.4242 240)) horizon (* height (/ 100 240))
            distance (/ (* focal 0.5) (max 0.75 (abs (- p.y horizon))))
            camera (/ (- (+ p.x 0.5) (/ width 2)) focal)
            ray [(- c (* s camera)) (+ s (* c camera))]
            hit (grid-ray [(get :boo-x) (get :boo-y)] ray grid)
            wall-distance (max 0.08 hit.x) h (/ focal wall-distance)
            top (- horizon (* h 0.5)) v (/ (- p.y top) h)
            wall-mask (* (step top p.y) (- 1 (step (+ top h) p.y)))
            wall-u (mix (+ (get :boo-y) (* wall-distance ray.y))
                        (+ (get :boo-x) (* wall-distance ray.x)) hit.y)
            row (floor (* v 6)) brick (fract (+ (* wall-u 4) (* (mod row 2) 0.5)))
            wall-mortar (max (- 1 (step 0.055 brick)) (step 0.93 (fract (* v 6))))
            wall-grain (noise [(floor (* wall-u 96)) (floor (* v 96))])
            wall-shade (/ (mix 0.82 0.62 hit.y) (+ 1 (* wall-distance 0.16)))
            wall-base (mix [0.43 0.42 0.54] [0.55 0.78 0.68] (step 1.5 hit.z))
            wall-color (* wall-base wall-shade (+ 0.88 (* wall-grain 0.12)) (- 1 (* wall-mortar 0.55)))
            wx (+ (get :boo-x) (* distance (- c (* s camera))))
            wy (+ (get :boo-y) (* distance (+ s (* c camera))))
            floor-side (step horizon p.y)
            tile (+ (* wx 2) (* (mod (floor (* wy 2)) 2) 0.5))
            mortar (max (- 1 (step 0.04 (fract tile))) (- 1 (step 0.05 (fract (* wy 2)))))
            grain (noise [(floor (* wx 48)) (floor (* wy 48))])
            shade (/ 1 (+ 0.25 (* distance 0.13)))
            stone (mix [0.1 0.12 0.19] [0.22 0.25 0.28] floor-side)
            color (* stone shade (+ 0.85 (* grain 0.15)) (- 1 (* mortar 0.55)))]
        (background (mix color wall-color wall-mask))))
    (mapv (fn [i] (boo-gpu-sprite i c s))
      (sort [0 1 2] (fn [a b] (- (boo-enemy-depth b c s) (boo-enemy-depth a c s))))))
  (fill "#e5dfb1")
  (line [(- (/ (canvas-width) 2) 5) (* (canvas-height) (/ 100 240))]
        [(+ (/ (canvas-width) 2) 5) (* (canvas-height) (/ 100 240))] 1)
  (line [(/ (canvas-width) 2) (- (* (canvas-height) (/ 100 240)) 5)]
        [(/ (canvas-width) 2) (+ (* (canvas-height) (/ 100 240)) 5)] 1)
  (let [hud-scale (min (/ (canvas-width) 320) (/ (canvas-height) 240))]
  (scope (translate [(- (canvas-width) (* 320 hud-scale)) 0]) (scale hud-scale) (boo-minimap))
  (scope
  (translate [(/ (- (canvas-width) (* 320 hud-scale)) 2) (- (canvas-height) (* 240 hud-scale))])
  (scale hud-scale)
  (boo-weapon)))
  ; Text stays at native or integer-multiple size, independently of world/HUD
  ; geometry. Fractional shrinking destroys glyphs before the preview scales up.
  (let [font-scale (max 1 (floor (min (/ (canvas-width) 320) (/ (canvas-height) 240))))
        hud-height (* 44 font-scale) hud-y (- (canvas-height) hud-height)
        left (* 8 font-scale) row1 (+ hud-y (* 4 font-scale)) row2 (+ hud-y (* 24 font-scale))]
  (fill "#111820") (rect [0 hud-y] [(canvas-width) hud-height])
  (fill "#e1d1ad") (boo-label left row1 font-scale "BOO PATROL")
  (fill (if (< (get :boo-health) 30) "#ef7c67" "#e1d1ad"))
  (boo-label (- (canvas-width) (* 192 font-scale)) row1 font-scale (str "HP " (get :boo-health)))
  (fill "#e1d1ad")
  (boo-label (- (canvas-width) (* 104 font-scale)) row1 font-scale (str "BOOS " (get :boo-kills) "/3"))
  (fill "#a6b8b2") (boo-label left row2 font-scale "WASD MOVE  ARROWS TURN  SPACE GLOW")
  (when (> (get :boo-hurt) 0.35)
    (fill "#b34848") (rect [0 0] [(canvas-width) 3]) (rect [0 (- hud-y 3)] [(canvas-width) 3]))
  (when (or (= (get :boo-health) 0) (get :boo-won))
    (let [panel-width (* 288 font-scale) panel-height (* 64 font-scale)
          x (floor (/ (- (canvas-width) panel-width) 2)) y (floor (/ (- hud-y panel-height) 2))]
      (fill "#10151d") (rect [x y] [panel-width panel-height])
      (fill "#ffe1a2") (boo-label (+ x (* 16 font-scale)) (+ y (* 10 font-scale)) font-scale
        (if (get :boo-won) "ALL GHOSTS TUCKED IN!" "TIME FOR A GHOST NAP"))
      (fill "#b6c6bd") (boo-label (+ x (* 16 font-scale)) (+ y (* 36 font-scale)) font-scale "PRESS R TO RESTART")))))
