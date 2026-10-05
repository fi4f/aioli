// Generator state is deliberately separate from gameplay parameters. Their
// source files are project resources, so users can import ordinary helper files.
export const generatorSources = {
  'generators/image.lisp': `; Only this hook is compiled. Add CPU init!/defn forms beside it.
(init! :image-radius 48)
(init! :image-x 160)
(init! :image-y 120)
(init! :image-color "#bbd6a6")
(init! :image-shape 0)
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
  'generators/audio.lisp': `(init! :sound-wave "sine")
(init! :sound-pitch 440)
(init! :sound-end 880)
(init! :sound-duration 0.3)
(init! :sound-gain 0.35)
(defn generate-sound []
  (voice (get :sound-wave) (get :sound-pitch) (get :sound-end)
         (get :sound-duration) (get :sound-gain)))`,
  'commands/center-player.lisp': `; Run explicitly from the command palette.
(set! :x 160)
(set! :y 190)
(set! :vy 0)`,
  'commands/export-image.lisp': `(export-image "assets/generated.png")`,
  'commands/export-audio.lisp': `(export-sound "assets/generated.wav")`,
};
