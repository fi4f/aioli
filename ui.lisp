; Immediate-mode widgets are Lisp functions, not native controls.
; Drawing primitives use the same per-pixel coverage as scene shaders.
(defn token-color [kind]
  (if (= kind "comment") "#65776a"
    (if (= kind "string") "#c2c59d"
      (if (= kind "keyword") "#a7c5af"
        (if (= kind "number") "#b9b09c"
          (if (= kind "delimiter") "#849689" (get :ui-text)))))))

; The host supplies buffer/input data. Lisp paints the source widget.
(defn code-editor [origin size tab]
  (buffer-open origin size tab)
  (scope
    (clip origin size)
    (let [selections (buffer-selections) rows (buffer-rows)]
      (fill "#344339")
      (repeat (count selections) i
        (let [selection (nth selections i)]
          (rect (nth selection 0) (nth selection 1))))
      (repeat (count rows) i
        (let [row (nth rows i) segments (nth row 2)]
          (fill "#526258") (text (nth row 0) (nth row 1))
          (repeat (count segments) j
            (let [token (nth segments j)]
              (fill (token-color (nth token 2)))
              (text (nth token 0) (nth token 1)))))))
    (when (buffer-caret)
      (fill (get :ui-accent))
      (rect (buffer-caret) [1 18]))))

(defn ui-button [id caption origin size active]
  (scope
    (fill (if active (get :ui-accent)
              (if (or (hit? origin size) (focused? id)) "#252e29" "#191f1b")))
    (rect origin size)
    (fill (if active "#162019" (get :ui-text)))
    (text [(+ (nth origin 0) 12) (+ (nth origin 1) 8)] caption))
  (region id caption origin size)
  (or (and (pointer-pressed?) (hit? origin size)) (activated? id)))

(defn ui-tab [id caption x active]
  (when (ui-button (str "tab-" id) caption [x 58] [70 32]
                   (= active id))
    (set! :tab id)))

(defn ui-slider [id caption key x y width low high]
  (scope
    (fill (get :ui-muted))
    (text [x y] caption)
    (text [(+ x width -48) y] (str (round (* (get key) 100)) "%"))
    (let [origin [x (+ y 28)] size [width 18]]
      (region id caption origin size key low high)
      (when (and (pointer-pressed?) (hit? origin size))
        (capture! id))
      (when (and (or (pointer-down?) (pointer-pressed?)) (captured? id))
        (set! key (clamp (+ low (* (/ (- (pointer-x) x) width)
                                 (- high low))) low high)))
      (fill "#303932")
      (rect [x (+ y 35)] [width 2])
      (fill (get :ui-accent))
      (rect [x (+ y 35)] [(* width (/ (- (get key) low)
                                      (- high low))) 2])
      (circle [(+ x (* width (/ (- (get key) low) (- high low))))
                (+ y 36)] 4))))

(defn ui-number-slider [id caption key x y width low high]
  (ui-slider id caption key x y width low high)
  ; Replace the value field with a number in this widget variant.
  (scope
    (fill (get :ui-panel))
    (rect [(+ x width -56) y] [56 20])
    (fill (get :ui-text))
    (text [(+ x width -48) y]
          (str (/ (round (* (get key) 100)) 100)))))

(defn ui-toggle [id caption key x y width]
  (when (ui-button id caption [x y] [width 32] (get key))
    (set! key (not (get key)))))

(defn ui-choice [id caption key choices x y width]
  (when (ui-button id (str caption " / " (get key)) [x y] [width 32] false)
    (repeat (count choices) i
      (when (= (get key) (nth choices i))
        (set! :choice-next (nth choices (mod (+ i 1) (count choices))))))
    (set! key (get :choice-next))))

(defn graphics-tools [x y width]
  (ui-number-slider :moon "Moon radius" :moon x y width 4 40)
  (ui-number-slider :wind "Wind" :wind x (+ y 62) width 0 10)
  (ui-slider :glow "Glow" :glow x (+ y 124) width 0 1)
  (ui-number-slider :speed "Walk speed" :speed x (+ y 186) width 20 160)
  (when (ui-button :palette "Cycle palette" [x (+ y 248)] [width 32] false)
    (set! :accent (if (= (get :accent) "#c4ef9b") "#e9bca9"
                     (if (= (get :accent) "#e9bca9") "#9fc8e7" "#c4ef9b"))))
  (scope
    (fill (get :accent))
    (rect [(+ x width -28) (+ y 256)] [16 16]))
  (when (ui-button :center "Center player" [x (+ y 292)] [width 32] false)
    (set! :x 160) (set! :y 190) (set! :vy 0)))

(defn sound-tools [x y width]
  (ui-choice :wave "Wave" :wave ["sine" "triangle" "square" "sawtooth" "noise"]
             x y width)
  (ui-number-slider :pitch "Start Hz" :pitch x (+ y 50) width 40 1200)
  (ui-number-slider :end-pitch "End Hz" :end-pitch x (+ y 112) width 40 1600)
  (ui-number-slider :duration "Duration" :duration x (+ y 174) width 0.05 1)
  (ui-slider :volume "Gain" :volume x (+ y 236) width 0 0.6)
  (ui-toggle :overtone "Mix overtone" :overtone x (+ y 298) width)
  (scope (fill (get :ui-accent)) (waveform [x (+ y 344)] [width 48]))
  (when (ui-button :audition "Play" [x (+ y 410)] [90 32] false) (play-sound))
  (when (ui-button :wav "Save WAV" [(+ x 100) (+ y 410)] [(- width 100) 32] false)
    (export-wav)))

; Shared window shell and project widgets are ordinary live Lisp definitions.
; The host only supplies file data, native input, GPU textures and export actions.
(defn project-window []
  (let [kind (get :window)
        w (min (if (or (= kind "files") (= kind "palette")) 720 960) (- (screen-width) 32))
        h (min (if (= kind "palette") 480
                   (if (= kind "files") 600 (if (> w 760) 580 690))) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2) y 64]
    ; This region intercepts background clicks without consuming child controls.
    (region :window "Project tool window" [x y] [w h])
    (fill "#0b100d") (rect [(- x 2) (- y 2)] [(+ w 4) (+ h 4)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (fill (get :ui-text))
    (text [(+ x 16) (+ y 12)]
      (if (= kind "files") "Project resources"
        (if (= kind "palette") "Commands / Ctrl+Shift+P"
          (if (= kind "image") "Image generator / 320 x 240" "Audio generator"))))
    (when (ui-button :close-window "Close" [(+ x w -84) (+ y 4)] [76 32] false)
      (set! :window ""))
    (scope
      (clip [x (+ y 42)] [w (- h 42)])
      (if (= kind "files") (file-explorer x (+ y 48) w (- h 48))
        (if (= kind "palette") (command-palette x (+ y 48) w (- h 48))
          (generator-window kind x (+ y 48) w (- h 48)))))))

(defn file-explorer [x y w h]
  (let [files (project-files) rows (min (count files) (max 0 (floor (/ (- h 174) 28))))]
    (when (ui-button :new-image "Image" [(+ x 16) y] [80 32] false) (set! :window "image"))
    (when (ui-button :new-audio "Audio" [(+ x 104) y] [80 32] false) (set! :window "audio"))
    (when (ui-button :add-resource "Import" [(+ x 192) y] [80 32] false) (import-resource))
    (repeat rows i
      (let [file (nth files i) path (nth file 0) type (nth file 1)]
        (when (ui-button (str "file-" path) (str (if (= type "asset") "* " "  ") path)
                [(+ x 16) (+ y 42 (* i 28))] [(- w 32) 26] (= (get :selected-file) path))
          (set! :selected-file path)) ))
    (let [bottom (+ y h -124)]
      (fill (get :ui-muted)) (text [(+ x 16) (- bottom 24)] (get :selected-file))
      (when (ui-button :files-prev "<" [(+ x 16) bottom] [40 28] false)
        (set! :file-offset (max 0 (- (get :file-offset) rows))))
      (when (ui-button :files-next ">" [(+ x 64) bottom] [40 28] false)
        (set! :file-offset (min (max 0 (- (project-file-count) rows)) (+ (get :file-offset) rows))))
      (when (ui-button :file-open "Open" [(+ x 112) bottom] [72 28] false) (open-file (get :selected-file)))
      (when (ui-button :file-download "Save" [(+ x 192) bottom] [72 28] false) (download-resource (get :selected-file)))
      (fill (get :ui-muted)) (text [(+ x 16) (+ bottom 38)] "Path / create or rename")
      (code-editor [(+ x 16) (+ bottom 60)] [(- w 32) 22] :__path)
      (when (ui-button :file-create "Create" [(+ x 16) (+ bottom 90)] [80 28] false) (create-file (path-input)))
      (when (ui-button :file-rename "Rename" [(+ x 104) (+ bottom 90)] [80 28] false)
        (rename-file (get :selected-file) (path-input)))
      (when (ui-button :file-delete "Delete" [(+ x 192) (+ bottom 90)] [80 28] false) (delete-file (get :selected-file))))))

(defn command-palette [x y w h]
  (fill (get :ui-muted)) (text [(+ x 16) y] "Search commands, or type Lisp and run")
  (code-editor [(+ x 16) (+ y 28)] [(- w 32) 100] :__palette)
  (when (ui-button :run-instruction "Run Lisp" [(+ x 16) (+ y 140)] [110 32] false) (run-instruction))
  (fill (get :ui-muted)) (text [(+ x 140) (+ y 148)] "Ctrl+Enter")
  (let [commands (palette-commands)]
    (repeat (min (count commands) (max 0 (floor (/ (- h 206) 38)))) i
      (let [path (nth commands i)]
        (when (ui-button (str "command-" path) path [(+ x 16) (+ y 192 (* i 38))] [(- w 32) 32] false)
          (run-command path))))))

(defn generator-window [kind x y w h]
  (let [wide (> w 760) left (if wide (floor (* w 0.55)) w)
        gx (if wide (+ x left 16) (+ x 16))
        gy (if wide y (+ y 220)) gw (if wide (- w left 32) (- w 32))
        code-height (if wide (- h 16) 200)]
    (code-editor [(+ x 16) y] [(- left 32) code-height]
      (if (= kind "image") "generators/image.lisp" "generators/audio.lisp"))
    (if (= kind "image")
      (let [preview-width (min gw (if wide 320 160)) preview-height (* preview-width 0.75)
            gy (+ gy 36)]
        (init! :image-shape 0)
        (when (ui-button :image-shape-control
                  (if (= (get :image-shape) 0) "Circle" (if (= (get :image-shape) 1) "Square" "Line"))
                  [gx (- gy 36)] [112 28] false)
          (set! :image-shape (mod (+ (get :image-shape) 1) 3)))
        (image-preview [gx gy] [preview-width preview-height])
        (ui-number-slider :image-radius-control "Radius" :image-radius gx (+ gy preview-height 12) gw 1 120)
        (ui-number-slider :image-x-control "X" :image-x gx (+ gy preview-height 66) gw 0 320)
        (ui-number-slider :image-y-control "Y" :image-y gx (+ gy preview-height 120) gw 0 240)
        (when (ui-button :image-color-control "Color" [gx (+ gy preview-height 176)] [72 28] false)
          (set! :image-color (if (= (get :image-color) "#bbd6a6") "#e9bca9" "#bbd6a6")))
        (when (ui-button :image-store "Keep" [(+ gx 80) (+ gy preview-height 176)] [72 28] false) (save-image-resource))
        (when (ui-button :image-export "PNG" [(+ gx 160) (+ gy preview-height 176)] [72 28] false) (export-image)))
      (do
        (ui-choice :sound-wave-control "Wave" :sound-wave ["sine" "triangle" "square" "sawtooth" "noise"] gx gy gw)
        (ui-number-slider :sound-pitch-control "Start Hz" :sound-pitch gx (+ gy 38) gw 40 1600)
        (ui-number-slider :sound-end-control "End Hz" :sound-end gx (+ gy 92) gw 40 1600)
        (ui-number-slider :sound-duration-control "Seconds" :sound-duration gx (+ gy 146) gw 0.05 2)
        (ui-slider :sound-gain-control "Gain" :sound-gain gx (+ gy 200) gw 0 1)
        (scope (fill (get :ui-accent)) (waveform [gx (+ gy 254)] [gw 48] true))
        (when (ui-button :sound-preview "Play" [gx (+ gy 316)] [72 28] false) (play-generated-sound))
        (when (ui-button :sound-store "Keep" [(+ gx 80) (+ gy 316)] [72 28] false) (save-sound-resource))
        (when (ui-button :sound-export "WAV" [(+ gx 160) (+ gy 316)] [72 28] false) (export-sound))))))
