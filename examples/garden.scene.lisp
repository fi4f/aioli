; init! sets defaults only when state is absent.
; Hot edits preserve the running world.
(init! :x 160 ["Player X" 6 314 1])
(init! :y 190 ["Player Y" 0 240 1])
(init! :vy 0 ["Vertical speed" -200 320 1])
(init! :speed 75 ["Walk speed" 20 160 1])
(init! :wind 3 ["Wind" 0 10 0.1])
(init! :moon 20 ["Moon radius" 4 40 1])
(init! :glow 0.65 ["Glow" 0 1 0.01])
(init! :accent "#c4ef9b" ["Palette"])
(init! :pitch 440 ["Start Hz" 40 1200 1])
(init! :end-pitch 880 ["End Hz" 40 1600 1])
(init! :duration 0.3 ["Duration" 0.05 1 0.01])
(init! :volume 0.35 ["Gain" 0 0.6 0.01])
(init! :wave "sine" ["Wave" ["sine" "triangle" "square" "sawtooth" "noise"]])
(init! :overtone true ["Mix overtone"])

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
    (set! :vy 0)))

; A patch is an ordinary Lisp function.
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
           (* (get :volume) 0.25))))

; One quad. A whole midnight garden.
; Drawing state belongs to each pixel.
(defpixel render [p time]
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
    (rect [2 -14] [2 2])))
