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
          (when (ui-button id (str caption " / " (if (= kind "data") (slice (json-write (get key)) 0 60) (get key))) [x y] [width 32] false)
            (edit-generator-field key)))))))

(defn generator-window [kind x y w h]
  (let [path (generator-path) files (generator-files)
        wide (> w 760) left (if wide (floor (* w 0.5)) w)
        gx (if wide (+ x left 16) (+ x 16))
        gy (if wide (+ y 42) (+ y 166)) gw (if wide (- w left 32) (- w 32))
        output (generator-output) fields (generator-fields)
        preview-height (if (= output "audio") 48 (if wide 150 90))
        fy (+ gy preview-height 20)
        height (max (get :ui-field-height) (- (+ y h) fy 136))]
    (when (ui-button :generator-select (if (= path "") "No .generator.lisp files" (str path " / Next"))
                    [(+ x 16) y] [(- w 32) 32] false)
      (repeat (count files) i
        (when (= path (nth files i))
          (open-generator (nth files (mod (+ i 1) (count files)))))))
    (when (not (= path ""))
      (code-editor [(+ x 16) (+ y 42)] [(- left 32) (if wide (- h 58) 108)] path)
      (if (= output "image")
        (image-preview [gx gy] [(min gw (* preview-height (/ 4 3))) preview-height])
        (if (= output "text")
          (do
            (init! :text-preview-offset 0) (init! :text-preview-x 0)
            (ui-inspector-scroll :generator-text-scroll :text-preview-offset gx gy gw preview-height (* (generator-text-line-count) 18))
            (text-preview [gx gy] [(- gw 16) preview-height]))
          (do (fill (get :ui-accent)) (waveform [gx gy] [gw preview-height] true))))
      (let [offset (ui-inspector-scroll :generator-inspector-scroll :inspector-offset gx fy gw height (* (count fields) (get :ui-field-height)))
            first (floor (/ offset (get :ui-field-height)))]
        (scope
          (clip [gx fy] [(- gw 16) height])
          (repeat (min (- (count fields) first) (+ 2 (floor (/ height (get :ui-field-height))))) i
            (generator-field (nth fields (+ first i)) gx (+ fy (* (+ first i) (get :ui-field-height)) (- 0 offset)) (- gw 16)))))
      (when (and (not (= (get :inspector-edit-key) ""))
                 (not (= (generator-edit-kind) "color")))
        (code-editor [gx (+ y h -122)] [(- gw 76) 32] :__generatorValue)
        (when (ui-button :inspector-apply "Apply" [(+ gx gw -72) (+ y h -122)] [72 32] false)
          (apply-generator-field)))
      (if (= output "image")
        (do
          (when (ui-button :generator-keep "Keep" [gx (+ y h -44)] [72 32] false) (save-image-resource))
          (when (ui-button :generator-export "PNG" [(+ gx 80) (+ y h -44)] [72 32] false) (export-image)))
        (if (= output "text")
          (do
            (scope (clip [gx (+ y h -84)] [gw 34])
              (fill (get :ui-muted)) (text [gx (+ y h -84)] (str "File: " (generator-filename)))
              (text [gx (+ y h -66)] "Shift+wheel scrolls sideways"))
            (when (ui-button :generator-generate "Generate" [gx (+ y h -44)] [88 32] false) (generate-text-preview))
            (when (ui-button :generator-keep "Keep" [(+ gx 96) (+ y h -44)] [64 32] false) (save-text-resource))
            (when (ui-button :generator-export "Download" [(+ gx 168) (+ y h -44)] [100 32] false) (export-text)))
        (do
          (when (ui-button :generator-play "Play" [gx (+ y h -44)] [72 32] false) (play-generated-sound))
          (when (ui-button :generator-keep "Keep" [(+ gx 80) (+ y h -44)] [72 32] false) (save-sound-resource))
          (when (ui-button :generator-export "WAV" [(+ gx 160) (+ y h -44)] [72 32] false) (export-sound))))))))
