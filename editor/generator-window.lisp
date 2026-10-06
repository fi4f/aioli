; A generator describes its state; this inspector has no recipe-specific controls.
(defn generator-text-editing? []
  (and (get :show-generator) (not (= (get :inspector-edit-key) ""))
       (not (= (generator-edit-kind) "color"))))

(defn toggle-generator-collapse []
  (set! :generator-collapsed (not (get :generator-collapsed)))
  (when (get :generator-collapsed) (set! :inspector-edit-key "")))
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

(defn generator-field-list [origin size]
  (let [fields (generator-fields) x (nth origin 0) y (nth origin 1)
        width (nth size 0) height (max 1 (nth size 1))
        offset (ui-inspector-scroll :generator-inspector-scroll :inspector-offset x y width height (* (count fields) (get :ui-field-height)))
        first (min (count fields) (floor (/ offset (get :ui-field-height))))
        last (min (count fields) (+ first 2 (floor (/ height (get :ui-field-height)))))]
    (scope (clip origin [(max 0 (- width 16)) height])
      (mapv (fn [i] (generator-field (nth fields i) x (+ y (* i (get :ui-field-height)) (- 0 offset)) (max 1 (- width 16))))
        (slice (range (count fields)) first last)))))

(defn generator-preview-content [origin size]
  (let [output (generator-output) x (nth origin 0) y (nth origin 1)
        w (nth size 0) h (nth size 1)]
    (if (= output "image")
      (image-preview origin [(min w (* h (/ 4 3))) h])
      (if (= output "text")
        (do (init! :text-preview-offset 0) (init! :text-preview-x 0)
          (ui-inspector-scroll :generator-text-scroll :text-preview-offset x y w h (* (generator-text-line-count) 18))
          (text-preview origin [(max 1 (- w 16)) h]))
        (do (fill (get :ui-accent)) (waveform origin size true))))))

(defn generator-output-controls []
  (let [output (generator-output)]
    (ui/row (map :gap 8)
      [(if (= output "audio") (ui/button :generator-play "Play" (fn [] (play-generated-sound)))
         (if (= output "text") (ui/button :generator-generate "Generate" (fn [] (generate-text-preview))) nil))
       (ui/button :generator-keep "Keep"
         (fn [] (if (= output "image") (save-image-resource)
           (if (= output "audio") (save-sound-resource) (save-text-resource)))))
       (ui/button :generator-export (if (= output "image") "PNG" (if (= output "audio") "WAV" "Download"))
         (fn [] (if (= output "image") (export-image)
           (if (= output "audio") (export-sound) (export-text)))))])))

(defn generator-pane-content [origin size]
  (when (not (get :generator-collapsed))
    (let [path (generator-path)]
      (ui/render origin size
        (ui/column (map :padding 16 :gap 12)
          [(ui/row (map)
             [(ui/with (map :grow 1) (ui/button :generator-select
                (if (= path "") "No generators" (str path " / Next")) (fn [] (select-next-generator))))
              (ui/button :generator-code "Code" (fn [] (open-generator-code)))])
           (if (= path "") (ui/muted "Add a .generator.lisp file to begin")
             (ui/column (map :grow 1 :gap 12)
               [(ui/custom (map :height (if (= (generator-output) "audio") 48
                   (min 150 (max 50 (* (nth size 1) 0.25))))) generator-preview-content)
                (ui/custom (map :grow 1) generator-field-list)
                (if (generator-text-editing?)
                  (ui/row (map)
                    [(ui/with (map :grow 1) (ui/code :__generatorValue))
                     (ui/button :inspector-apply "Apply" (fn [] (apply-generator-field)))]) nil)
                (if (= (generator-output) "text") (ui/muted (str "File: " (generator-filename))) nil)
                (generator-output-controls)]))])))))
