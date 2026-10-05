// Generator state is deliberately separate from gameplay parameters. Their
// source files are project resources, so users can import ordinary helper files.
export const generatorSources = {
  'examples/generators/image.generator.lisp': `(generator :image "Shapes")
; Drawables compose shapes and nested GPU pixels in painter order.
(init! :image-radius 48 ["Radius" 1 120 1])
(init! :image-x 160 ["X" 0 320 1])
(init! :image-y 120 ["Y" 0 240 1])
(init! :image-color "#bbd6a6" ["Color"])
(init! :image-shape 0 ["Shape" [0 1 2]])
(defdraw render []
  (pixels [p time]
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
          [(+ (param :image-x) (param :image-radius)) (param :image-y)] 4))))`,
  'examples/generators/audio.generator.lisp': `(generator :audio "Tone")
(init! :sound-wave "sine" ["Wave" ["sine" "triangle" "square" "sawtooth" "noise"]])
(init! :sound-pitch 440 ["Start Hz" 40 1600 1])
(init! :sound-end 880 ["End Hz" 40 1600 1])
(init! :sound-duration 0.3 ["Seconds" 0.05 2 0.01])
(init! :sound-gain 0.35 ["Gain" 0 1 0.01])
(defn generate-sound []
  (voice (get :sound-wave) (get :sound-pitch) (get :sound-end)
         (get :sound-duration) (get :sound-gain)))`,
  'examples/generators/text.generator.lisp': `(generator :text "Level CSV" "levels/generated.csv")
(init! :level-name "garden" ["Level name"])
(init! :level-width 320 ["Width" 64 1024 16])
(init! :level-height 240 ["Height" 64 1024 16])
(defn generate-text []
  (str "name,width,height\\n" (get :level-name) "," (get :level-width) "," (get :level-height) "\\n"))`,
  'examples/commands/center-player.command.lisp': `; Run explicitly from the command palette.
(game-set! :x 160)
(game-set! :y 190)
(game-set! :vy 0)`,
  'examples/commands/export-image.command.lisp': `(export-image "assets/generated.png")`,
  'examples/commands/export-audio.command.lisp': `(export-sound "assets/generated.wav")`,
};
