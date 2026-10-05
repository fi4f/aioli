; Live state inspector. Annotations share the generator inspector vocabulary.
(defn scene-inspector-field [field x y width]
  (let [key (nth field 0) caption (nth field 1) kind (nth field 2)
        id (str "scene-field-" key) binding (str "__scene-" key)
        before (scene-field-value key)]
    (set! binding before)
    (if (= kind "number")
      (do (ui-number-slider id caption binding x y width (nth field 3) (nth field 4))
          (scene-field-step key))
      (if (= kind "choice")
        (ui-choice id caption binding (nth field 6) x y width)
        (if (= kind "boolean")
          (ui-toggle id caption binding x y width)
          (when (ui-button id (str caption " / " before) [x y] [width 32] false)
            (edit-scene-field key)))))
    (when (not (= before (get binding))) (set-scene-field key (get binding)))))

(defn parameter-pane [w h narrow tools-width]
  (let [collapsed (get :inspector-collapsed)
        pane-width (if collapsed (get :ui-collapsed-width) (get :ui-inspector-width))
        x (- w pane-width) y 124 width (- pane-width 32)
        fields (scene-fields) height (max (get :ui-field-height) (- h y 94))]
    (fill (get :ui-panel)) (rect [x 51] [pane-width (- h 81)])
    (ui-pane-toggle :collapse-inspector :inspector-collapsed "Scene inspector" x 51 pane-width true)
    (if collapsed
      (asset-icon "scene" (+ x 12) 99)
      (do
    (fill (get :ui-muted))
    (scope (clip [(+ x 16) 88] [width 20]) (text [(+ x 16) 88] (preview-path)))
    (let [offset (ui-inspector-scroll :scene-inspector-scroll :scene-inspector-offset (+ x 16) y width height (* (count fields) (get :ui-field-height)))
          first (floor (/ offset (get :ui-field-height)))]
      (scope
        (clip [(+ x 16) y] [(- width 16) height])
        (repeat (min (- (count fields) first) (+ 2 (floor (/ height (get :ui-field-height))))) i
          (scene-inspector-field (nth fields (+ first i)) (+ x 16) (+ y (* (+ first i) (get :ui-field-height)) (- 0 offset)) (- width 16)))))
    (when (= (count fields) 0)
      (fill (get :ui-muted)) (text [(+ x 16) y] "No state fields yet"))
    (when (and (not (= (get :scene-edit-key) "")) (not (= (scene-edit-kind) "color")))
      (code-editor [(+ x 16) (- h 72)] [156 32] :__sceneValue)
      (when (ui-button :scene-inspector-apply "Apply" [(+ x 180) (- h 72)] [68 32] false)
        (apply-scene-field)))))))
