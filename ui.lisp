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
        w (min (if (= kind "palette") 720 960) (- (screen-width) 32))
        h (min (if (= kind "palette") 480 (if (> w 760) 580 690)) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2) y 64]
    ; This region intercepts background clicks without consuming child controls.
    (region :window "Project tool window" [x y] [w h])
    (fill "#0b100d") (rect [(- x 2) (- y 2)] [(+ w 4) (+ h 4)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (fill (get :ui-text))
    (text [(+ x 16) (+ y 12)]
      (if (= kind "palette") "Commands / Ctrl+Shift+P"
        (if (= kind "image") "Image generator / 320 x 240" "Audio generator")))
    (when (ui-button :close-window "Close" [(+ x w -84) (+ y 4)] [76 32] false)
      (set! :window ""))
    (scope
      (clip [x (+ y 42)] [w (- h 42)])
      (if (= kind "palette") (command-palette x (+ y 48) w (- h 48))
        (generator-window kind x (+ y 48) w (- h 48))))))

 ; Icons are composed from the same pixel primitives as the rest of the editor.
(defn asset-icon [kind x y]
  (scope
    (fill (get :ui-muted))
    (if (= kind "folder")
      (do (rect [x (+ y 3)] [14 10]) (rect [x y] [6 4]))
      (if (= kind "audio")
        (do (line [(+ x 5) (+ y 2)] [(+ x 5) (+ y 11)] 1)
            (line [(+ x 5) (+ y 2)] [(+ x 12) y] 2)
            (line [(+ x 12) y] [(+ x 12) (+ y 9)] 1)
            (circle [(+ x 3) (+ y 11)] 2) (circle [(+ x 10) (+ y 9)] 2))
        (do
          (line [x y] [(+ x 13) y] 1) (line [x y] [x (+ y 14)] 1)
          (line [(+ x 13) y] [(+ x 13) (+ y 14)] 1)
          (line [x (+ y 14)] [(+ x 13) (+ y 14)] 1)
          (if (= kind "image")
            (do (circle [(+ x 9) (+ y 4)] 2)
                (line [(+ x 2) (+ y 11)] [(+ x 5) (+ y 7)] 1)
                (line [(+ x 5) (+ y 7)] [(+ x 11) (+ y 12)] 1))
            (if (= kind "code")
              (do (line [(+ x 5) (+ y 4)] [(+ x 2) (+ y 7)] 1)
                  (line [(+ x 2) (+ y 7)] [(+ x 5) (+ y 10)] 1)
                  (line [(+ x 8) (+ y 4)] [(+ x 11) (+ y 7)] 1)
                  (line [(+ x 11) (+ y 7)] [(+ x 8) (+ y 10)] 1))
              (do (rect [(+ x 3) (+ y 4)] [7 1]) (rect [(+ x 3) (+ y 8)] [7 1])))))))))

; The pane contains only navigation. File operations live in menus and dialogs.
(defn file-explorer [x y w h]
  (fill (get :ui-panel)) (rect [x y] [w h])
  (fill "#27312a") (rect [(+ x w -1) y] [1 h])
  (fill (get :ui-text)) (text [(+ x 16) (+ y 12)] "Project files")
  (when (ui-button :hide-files "x" [(+ x w -40) (+ y 4)] [32 28] false)
    (set! :show-files false))
  (let [files (project-tree) tree-height (max 26 (- h 44))
        capacity (min 64 (max 1 (floor (/ tree-height 26))))
        rows (min (count files) capacity) total (project-tree-count)]
    (region :files-tree "Project folder tree" [(+ x 8) (+ y 36)] [(- w 16) tree-height])
    (scope
      (clip [(+ x 8) (+ y 36)] [(- w 16) tree-height])
      (repeat rows i
        (let [file (nth files i) path (nth file 0) folder (= (nth file 1) "folder")
              id (str (if folder "folder-" "file-") path)
              indent (min (* (nth file 4) 14) (- w 100))
              rx (+ x 8 indent) ry (+ y 36 (* i 26))
              origin [(+ x 8) ry] size [(- w 24) 24]]
          (fill (if (and (not folder) (= (get :selected-file) path)) "#344339"
                  (if (or (hit? origin size) (focused? id)) "#252e29" (get :ui-panel))))
          (rect origin size)
          (when folder
            (fill (get :ui-muted))
            (if (nth file 5)
              (do (line [rx (+ ry 9)] [(+ rx 4) (+ ry 13)] 1)
                  (line [(+ rx 4) (+ ry 13)] [(+ rx 8) (+ ry 9)] 1))
              (do (line [(+ rx 2) (+ ry 7)] [(+ rx 6) (+ ry 11)] 1)
                  (line [(+ rx 6) (+ ry 11)] [(+ rx 2) (+ ry 15)] 1))))
          (asset-icon (nth file 6) (+ rx 14) (+ ry 5))
          (fill (get :ui-text)) (text [(+ rx 36) (+ ry 5)] (nth file 3))
          (resource-region path (nth file 1) (nth file 6) origin size)
          (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
            (if folder (toggle-folder path)
              (do (set! :selected-file path) (open-file path))))))
      (when (> total capacity)
        (let [track (* capacity 26) thumb (max 18 (* track (/ capacity total)))
              offset (project-tree-offset) limit (- total capacity)
              sx (+ x w -8) sy (+ y 36)]
          (fill "#27312a") (rect [sx sy] [3 track])
          (fill (get :ui-muted)) (rect [sx (+ sy (* (- track thumb) (/ offset limit)))] [3 thumb])
          (region :files-scroll "Scroll files" [(- sx 3) sy] [9 track])
          (when (and (pointer-pressed?) (hit? [(- sx 3) sy] [9 track])) (capture! :files-scroll))
          (when (and (pointer-down?) (captured? :files-scroll))
            (set! :file-offset (round (* limit (clamp (/ (- (pointer-y) sy (/ thumb 2)) (- track thumb)) 0 1))))))))))

(defn file-path-dialog []
  (let [w (min 440 (- (screen-width) 32)) x (/ (- (screen-width) w) 2) y 90
        rename (= (get :file-operation) "rename")]
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ w 2) 182])
    (fill (get :ui-panel)) (rect [x y] [w 180])
    (region :file-path-panel "Filename dialog" [x y] [w 180])
    (fill (get :ui-text)) (text [(+ x 16) (+ y 16)] (if rename "Rename file" "New Lisp file"))
    (fill (get :ui-muted)) (text [(+ x 16) (+ y 48)] "Project path / folders separated by /")
    (code-editor [(+ x 16) (+ y 78)] [(- w 32) 28] :__path)
    (when (ui-button (if rename :file-rename :file-create) (if rename "Rename" "Create") [(+ x 16) (+ y 128)] [96 32] false)
      (if rename (rename-file (get :selected-file) (path-input)) (create-file (path-input))))
    (when (ui-button :close-window "Cancel" [(+ x 124) (+ y 128)] [96 32] false) (set! :window ""))))

(defn file-context-menu [w h]
  (let [width (min 260 (- w 16)) height 194
        x (clamp (get :context-x) 8 (- w width 8)) y (clamp (get :context-y) 52 (- h height 32))
        leaf (= (get :context-kind) "file")]
    (region :context-dismiss "Close file menu" [0 50] [w (- h 80)])
    (when (pointer-pressed?) (set! :file-context false))
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ width 2) (+ height 2)])
    (fill (get :ui-panel)) (rect [x y] [width height])
    (region :context-panel "File actions" [x y] [width height])
    (when (menu-action :context-new "New file..." "" x (+ y 4) width true nil) (prepare-file-path))
    (when (menu-action :context-import "Import resource..." "" x (+ y 34) width true nil) (import-resource))
    (menu-divider x (+ y 69) width)
    (when (menu-action :context-open "Open" "" x (+ y 74) width leaf nil) (open-file (get :selected-file)))
    (when (menu-action :context-download "Download" "" x (+ y 104) width leaf nil) (download-resource (get :selected-file)))
    (when (menu-action :context-rename "Rename..." "" x (+ y 134) width (and leaf (selected-file-removable?)) nil) (prepare-file-path true))
    (when (menu-action :context-delete "Delete" "" x (+ y 164) width (and leaf (selected-file-removable?)) nil) (delete-file (get :selected-file)))))

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

; Menu layout, checked/disabled states, and commands remain ordinary Lisp.
(defn menu-title [id caption x width]
  (when (ui-button id caption [x 8] [width 32] (= (get :menu) id))
    (set! :file-context false) (set! :context-kind "")
    (set! :menu (if (= (get :menu) id) false id)))
  (when (and (get :menu) (pointer-moved?) (not (= (get :menu) id)) (hit? [x 8] [width 32]))
    (set! :menu id)))

(defn editor-menu-bar []
  (menu-title :file "File" 8 48)
  (menu-title :project "Project" 56 80)
  (menu-title :view "View" 136 56)
  (menu-title :edit "Edit" 192 56)
  (menu-title :about "About" 248 72))

(defn menu-action [id label shortcut x y width enabled checked]
  (let [origin [x y] size [width 30]
        hovered (and enabled (or (hit? origin size) (focused? id)))]
    (fill (if hovered "#303d33" (get :ui-panel))) (rect origin size)
    (fill (if enabled (get :ui-text) "#526258"))
    (when (= checked true) (text [(+ x 6) (+ y 6)] "x"))
    (text [(+ x 24) (+ y 6)] label)
    (when (not (= shortcut ""))
      (fill (if enabled (get :ui-muted) "#526258"))
      (text [(+ x width -100) (+ y 6)] shortcut))
    (menu-region id label origin size enabled checked)
    (if (and enabled (or (activated? id) (and (pointer-pressed?) (hit? origin size))))
      (do (set! :menu false) (set! :file-context false) true) false)))

(defn menu-divider [x y width]
  (fill "#303b32") (rect [(+ x 8) y] [(- width 16) 1]))

(defn editor-menu [w h]
  (let [kind (get :menu) width (min 312 (- w 16))
        anchor (if (= kind "file") 8 (if (= kind "project") 56 (if (= kind "view") 136 (if (= kind "edit") 192 248))))
        x (min anchor (- w width 8)) y 52
        height (if (= kind "file") 260 (if (= kind "project") (if (recovery?) 180 144) (if (= kind "view") (if (recovery?) 304 272) (if (= kind "edit") 204 102))))]
    ; A background region dismisses the menu without also activating a pane.
    (region :menu-dismiss "Close menu" [0 50] [w (- h 80)])
    (when (and (pointer-pressed?) (hit? [0 50] [w (- h 80)])) (set! :menu false))
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ width 2) (+ height 2)])
    (fill (get :ui-panel)) (rect [x y] [width height])
    (region :menu-panel "Menu" [x y] [width height])
    (scope
      (clip [x y] [width height])
      (if (= kind "file")
        (do
          (when (menu-action :new-file "New file..." "" x (+ y 4) width true nil) (prepare-file-path))
          (when (menu-action :import "Open project..." "Ctrl+O" x (+ y 34) width true nil) (import-project))
          (when (menu-action :export "Save project..." "Ctrl+S" x (+ y 64) width true nil) (export-project))
          (menu-divider x (+ y 99) width)
          (when (menu-action :import-resource "Import resource..." "" x (+ y 104) width true nil) (import-resource))
          (when (menu-action :download-selected "Download selected file" "" x (+ y 134) width (selected-file?) nil) (download-resource (get :selected-file)))
          (when (menu-action :rename-file "Rename file..." "" x (+ y 164) width (selected-file-removable?) nil) (prepare-file-path true))
          (when (menu-action :delete-file "Delete file" "" x (+ y 194) width (selected-file-removable?) nil) (delete-file (get :selected-file)))
          (when (menu-action :png "Export game PNG" "" x (+ y 224) width true nil) (export-png)))
        (if (= kind "project")
          (do
            (when (menu-action :evaluate "Run / Evaluate" "Ctrl+Enter" x (+ y 4) width true nil) (evaluate-project))
            (when (menu-action :pause (if (get :paused) "Play" "Pause") "" x (+ y 34) width true nil) (set! :paused (not (get :paused))))
            (when (menu-action :reset "Reset state" "" x (+ y 64) width true nil) (reset-project))
            (menu-divider x (+ y 99) width)
            (when (menu-action :preset "Next demo scene" "" x (+ y 104) width true nil) (next-scene))
            (when (recovery?)
              (when (menu-action :upgrade-editor "Use latest editor" "" x (+ y 144) width true nil) (upgrade-editor))))
          (if (= kind "view")
            (do
              (when (menu-action :code "Code pane" "" x (+ y 4) width true (and (get :show-code) (or (>= w 850) (not (get :show-files)))))
                (set! :show-code (if (and (< w 850) (get :show-files)) true (not (get :show-code))))
                (when (< w 850) (set! :show-files false)))
              (when (menu-action :files "Files pane" "" x (+ y 34) width true (get :show-files))
                (set! :show-files (not (get :show-files))) (set! :file-path-editing false))
              (when (menu-action :tools "Parameter tools" "" x (+ y 64) width true (get :show-tools)) (set! :show-tools (not (get :show-tools))))
              (menu-divider x (+ y 99) width)
              (when (menu-action :image-generator "Image generator" "" x (+ y 104) width true nil) (set! :window "image"))
              (when (menu-action :audio-generator "Audio generator" "" x (+ y 134) width true nil) (set! :window "audio"))
              (when (menu-action :commands "Command palette" "Ctrl+Shift+P" x (+ y 164) width true nil) (set! :window "palette"))
              (when (menu-action :wgsl "Compiled WGSL" "" x (+ y 194) width true nil) (set! :tab "wgsl") (set! :show-code true) (set! :show-files false))
              (when (menu-action :recovery-shell "Recovery shell" "F2" x (+ y 234) width true nil) (open-recovery))
              (when (recovery?)
                (when (menu-action :leave-recovery "Project editor" "" x (+ y 264) width true nil) (leave-recovery))))
            (if (= kind "edit")
              (do
                (when (menu-action :undo "Undo" "Ctrl+Z" x (+ y 4) width (can-edit-buffer? :undo) nil) (edit-buffer :undo))
                (when (menu-action :redo "Redo" "Ctrl+Y" x (+ y 34) width (can-edit-buffer? :redo) nil) (edit-buffer :redo))
                (menu-divider x (+ y 69) width)
                (when (menu-action :cut "Cut" "Ctrl+X" x (+ y 74) width (can-edit-buffer? :cut) nil) (edit-buffer :cut))
                (when (menu-action :copy "Copy" "Ctrl+C" x (+ y 104) width (can-edit-buffer? :copy) nil) (edit-buffer :copy))
                (when (menu-action :paste "Paste" "Ctrl+V" x (+ y 134) width (can-edit-buffer? :paste) nil) (edit-buffer :paste))
                (when (menu-action :select-all "Select all" "Ctrl+A" x (+ y 164) width (can-edit-buffer? :select-all) nil) (edit-buffer :select-all)))
              (do
                (when (menu-action :about-aioli "About aioli" "" x (+ y 4) width true nil) (set! :window "about"))
                (when (menu-action :docs "Documentation" "" x (+ y 34) width true nil) (open-docs))
                (when (menu-action :help "Language guide" "" x (+ y 64) width true nil) (set! :tab "guide") (set! :show-code true) (set! :show-files false))))))))))

(defn about-aioli []
  (let [w (min 400 (- (screen-width) 32)) x (/ (- (screen-width) w) 2) y 80]
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ w 2) 242])
    (fill (get :ui-panel)) (rect [x y] [w 240])
    (region :about-panel "About aioli" [x y] [w 240])
    (scope (clip [x y] [w 240])
      (fill (get :ui-text)) (text [(+ x 20) (+ y 20)] "aioli / 0.1")
      (fill (get :ui-muted))
      (text [(+ x 20) (+ y 60)] "all in one lisp")
      (text [(+ x 20) (+ y 96)] "A live pixel-first game workshop.")
      (text [(+ x 20) (+ y 124)] "The editor itself is Lisp.")
      (when (ui-button :close-window "Close" [(+ x 20) (+ y 184)] [80 32] false) (set! :window "")))))
