; A generator describes its state; this inspector has no recipe-specific controls.
(defn generator-field [field x y width]
  (let [key (nth field 0) caption (nth field 1) kind (nth field 2)
        id (str "generator-field-" key)]
    (if (= kind "number")
      (do (ui-number-slider id caption key x y width (nth field 3) (nth field 4))
          (normalize-generator-field key))
      (if (= kind "choice")
        (ui-choice id caption key (nth field 6) x y width)
        (if (= kind "boolean")
          (ui-toggle id caption key x y width)
          (when (ui-button id (str caption " / " (get key)) [x y] [width 32] false)
            (edit-generator-field key)))))))

(defn generator-window [kind x y w h]
  (let [path (generator-path) files (generator-files)
        wide (> w 760) left (if wide (floor (* w 0.5)) w)
        gx (if wide (+ x left 16) (+ x 16))
        gy (if wide (+ y 42) (+ y 166)) gw (if wide (- w left 32) (- w 32))
        output (generator-output) fields (generator-fields)
        preview-height (if (= output "image") (if wide 150 90) 48)
        fy (+ gy preview-height 20)
        height (max 56 (- (+ y h) fy 136))]
    (when (ui-button :generator-select (if (= path "") "No .generator.lisp files" (str path " / Next"))
                    [(+ x 16) y] [(- w 32) 32] false)
      (repeat (count files) i
        (when (= path (nth files i))
          (open-generator (nth files (mod (+ i 1) (count files)))))))
    (when (not (= path ""))
      (code-editor [(+ x 16) (+ y 42)] [(- left 32) (if wide (- h 58) 108)] path)
      (if (= output "image")
        (image-preview [gx gy] [(min gw (* preview-height (/ 4 3))) preview-height])
        (do (fill (get :ui-accent)) (waveform [gx gy] [gw preview-height] true)))
      (let [offset (ui-inspector-scroll :generator-inspector-scroll :inspector-offset gx fy gw height (* (count fields) 56))
            first (floor (/ offset 56))]
        (scope
          (clip [gx fy] [(- gw 16) height])
          (repeat (min (- (count fields) first) (+ 2 (floor (/ height 56)))) i
            (generator-field (nth fields (+ first i)) gx (+ fy (* (+ first i) 56) (- 0 offset)) (- gw 16)))))
      (when (and (not (= (get :inspector-edit-key) ""))
                 (not (= (generator-edit-kind) "color")))
        (code-editor [gx (+ y h -122)] [(- gw 76) 32] :__generatorValue)
        (when (ui-button :inspector-apply "Apply" [(+ gx gw -72) (+ y h -122)] [72 32] false)
          (apply-generator-field)))
      (if (= output "image")
        (do
          (when (ui-button :generator-keep "Keep" [gx (+ y h -44)] [72 32] false) (save-image-resource))
          (when (ui-button :generator-export "PNG" [(+ gx 80) (+ y h -44)] [72 32] false) (export-image)))
        (do
          (when (ui-button :generator-play "Play" [gx (+ y h -44)] [72 32] false) (play-generated-sound))
          (when (ui-button :generator-keep "Keep" [(+ gx 80) (+ y h -44)] [72 32] false) (save-sound-resource))
          (when (ui-button :generator-export "WAV" [(+ gx 160) (+ y h -44)] [72 32] false) (export-sound)))))))
