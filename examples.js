export const garden = `; One quad. A whole midnight garden.
; Drawing state belongs to each pixel.
(defpixel garden [p time]
  (background "#111c30")

  ; A little grain in the sky.
  (fill (mix [0.07 0.11 0.19]
             [0.12 0.20 0.28]
             (noise (* p 0.08))))
  (rect [0 0] [320 240])

  ; Stars: repetition expands at compile time.
  (fill "#b3ccb4")
  (repeat 24 i
    (rect [(mod (+ (* i 73) 19) 320)
           (mod (+ (* i 31) 7) 112)] [1 1]))

  ; The moon and its shadow.
  (fill (param :accent))
  (circle [245 48] (param :moon))
  (fill "#111c30")
  (circle [255 42] (param :moon))

  ; Rolling hills, still just pixel coverage.
  (fill "#253d42")
  (circle [65 260] 128)
  (circle [250 278] 143)
  (fill "#365348")
  (circle [140 289] 126)
  (fill "#182e30")
  (rect [0 190] [320 50])
  (fill "#638368")
  (rect [0 190] [320 2])

  ; Flowers sway independently.
  (repeat 12 i
    (scope
      (translate [(+ 15 (* i 27)) 190])
      (let [sway (* (param :wind)
                    (sin (+ (* time 1.4) i)))
            tall (+ 15 (mod (* i 7) 22))]
        (fill "#638368")
        (line [0 0] [sway (- tall)] 2)
        (fill "#385b43")
        (rect [2 -8] [5 3])
        (fill (param :accent))
        (circle [sway (- tall)] 4)
        (fill "#f6dfaf")
        (circle [sway (- tall)] 1))))

  ; Fireflies use additive blending.
  (scope
    (blend :add)
    (opacity (param :glow))
    (fill (param :accent))
    (repeat 9 i
      (circle [(+ 24 (* i 33)
                  (* 6 (sin (+ time i))))
               (+ 120 (* 18 (cos (+ time i))))]
              2)))

  ; Gameplay state arrives as uniforms.
  (scope
    (translate [(param :x) (param :y)])
    (fill "#c4ef9b")
    (rect [-5 -12] [10 12])
    (circle [0 -12] 5)
    (fill "#243b35")
    (rect [-2 -14] [2 2])
    (rect [2 -14] [2 2])))`;
export const orb = `; A procedural bloom: transform, mix, glow.
(defpixel bloom [p time]
  (background "#101b25")
  (translate [160 120])
  (scope
    (blend :add)
    (opacity (param :glow))
    (repeat 16 i
      (scope
        (rotate (+ (* i 0.3927) (* time 0.15)))
        (fill (mix [0.2 0.5 0.7]
                   [0.8 0.9 0.4]
                   (/ i 16)))
        (circle [(+ 40 (* 12 (sin time))) 0]
                (+ 15 (* 5 (sin (+ time i))))))))
  (fill (param :accent))
  (circle [0 0] (param :moon))
  (fill "#101b25")
  (circle [4 -4] (* (param :moon) 0.7)))`;
export const plasma = `; Direct shader math + immediate drawing.
(defpixel liquid [p time]
  (let [wave (+ (sin (+ (* p.x 0.04) time))
               (cos (- (* p.y 0.05) time)))
        rings (sin (- (* (length (- p [160 120]))
                         0.07) time))]
    (background
      (rgb (+ 0.08 (* 0.06 wave))
           (+ 0.30 (* 0.15 rings))
           (+ 0.26 (* 0.10 wave)))))
  (scope
    (translate [160 120])
    (rotate (* time 0.2))
    (fill (param :accent))
    (opacity (param :glow))
    (repeat 8 i
      (scope
        (rotate (* i 0.7854))
        (rect [30 -1] [55 2]))))
  (fill "#ecedc3")
  (circle [(param :x) (param :y)] 4))`;
export const game = `; init! sets defaults only when state is absent.
; Hot edits preserve the running world.
(init! :x 160)
(init! :y 190)
(init! :vy 0)
(init! :speed 75)
(init! :wind 3)
(init! :moon 20)
(init! :glow 0.65)
(init! :accent "#c4ef9b")
(init! :pitch 440)
(init! :end-pitch 880)
(init! :duration 0.3)
(init! :volume 0.35)
(init! :wave "sine")
(init! :overtone true)

(defn update [dt]
  (when (or (key? "ArrowLeft") (key? "a"))
    (set! :x (- (get :x) (* (get :speed) dt))))
  (when (or (key? "ArrowRight") (key? "d"))
    (set! :x (+ (get :x) (* (get :speed) dt))))
  (set! :x (clamp (get :x) 6 314))

  (when (and (or (key? " ") (key? "w")
                 (key? "ArrowUp"))
             (>= (get :y) 190))
    (set! :vy -130)
    (play-sound))

  (set! :vy (+ (get :vy) (* 320 dt)))
  (set! :y (+ (get :y) (* (get :vy) dt)))
  (when (> (get :y) 190)
    (set! :y 190)
    (set! :vy 0)))`;
export const audio = `; A patch is an ordinary Lisp function.
; Each voice mixes into one procedural buffer.
; waveform, start Hz, end Hz, duration, gain
(defn sound []
  (voice (get :wave)
         (get :pitch)
         (get :end-pitch)
         (get :duration)
         (get :volume))
  (when (get :overtone)
    (voice :triangle
           (* (get :pitch) 0.5)
           (* (get :end-pitch) 0.5)
           (get :duration)
           (* (get :volume) 0.25))))`;
export const defaults = { scene: garden, game, audio };
export const presets = { garden, orb, plasma };
