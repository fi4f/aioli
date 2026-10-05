// Generator state is deliberately separate from gameplay parameters. Their
// source files are project resources, so users can import ordinary helper files.
export const generatorSources = {
  'generators/image.generator.lisp': `(generator :image "Shapes")
; Only this hook is compiled. Add CPU init!/defn forms beside it.
(init! :image-radius 48 ["Radius" 1 120 1])
(init! :image-x 160 ["X" 0 320 1])
(init! :image-y 120 ["Y" 0 240 1])
(init! :image-color "#bbd6a6" ["Color"])
(init! :image-shape 0 ["Shape" [0 1 2]])
(defpixel image [p time]
  (background "#101613")
  (fill (param :image-color))
  ; Shape masks let GUI choices compose with ordinary pixel drawing.
  (scope
    (opacity (- 1 (step 0.5 (param :image-shape))))
    (circle [(param :image-x) (param :image-y)] (param :image-radius)))
  (scope
    (opacity (* (step 0.5 (param :image-shape))
                (- 1 (step 1.5 (param :image-shape)))))
    (rect [(- (param :image-x) (param :image-radius))
           (- (param :image-y) (param :image-radius))]
          [(* 2 (param :image-radius)) (* 2 (param :image-radius))]))
  (scope
    (opacity (step 1.5 (param :image-shape)))
    (line [(- (param :image-x) (param :image-radius)) (param :image-y)]
          [(+ (param :image-x) (param :image-radius)) (param :image-y)] 4)))`,
  'generators/audio.generator.lisp': `(generator :audio "Tone")
(init! :sound-wave "sine" ["Wave" ["sine" "triangle" "square" "sawtooth" "noise"]])
(init! :sound-pitch 440 ["Start Hz" 40 1600 1])
(init! :sound-end 880 ["End Hz" 40 1600 1])
(init! :sound-duration 0.3 ["Seconds" 0.05 2 0.01])
(init! :sound-gain 0.35 ["Gain" 0 1 0.01])
(defn generate-sound []
  (voice (get :sound-wave) (get :sound-pitch) (get :sound-end)
         (get :sound-duration) (get :sound-gain)))`,
  'commands/center-player.command.lisp': `; Run explicitly from the command palette.
(set! :x 160)
(set! :y 190)
(set! :vy 0)`,
  'commands/export-image.command.lisp': `(export-image "assets/generated.png")`,
  'commands/export-audio.command.lisp': `(export-sound "assets/generated.wav")`,
};
