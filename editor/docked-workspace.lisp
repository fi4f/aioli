; Pane bodies receive one bound from their dock host. Nested components lay out
; their own children; source buffers and application state survive pane moves.
(defn code-pane-content [origin size]
  (if (get :code-collapsed)
    (asset-icon "code" (+ (nth origin 0) 12) (+ (nth origin 1) 12))
    (ui/render origin size
      (ui/column (map :padding 8 :gap 8)
        [(ui/custom (map :height 34) (fn [p s] (code-tab-strip (nth p 0) (nth p 1) (nth s 0))))
         (ui/muted (active-code-path))
         (ui/with (map :grow 1)
           (if (and (= (get :window) "") (not (generator-text-editing?)))
             (if (= (get :tab) "") (ui/muted "Open a source file from Files") (ui/code (get :tab)))
             (ui/muted "Tool input active")))]))))

(defn game-pane-content [origin size]
  (when (not (get :game-collapsed))
  (ui/render origin size
    (ui/column (map :padding 8 :gap 8)
      [(ui/row (map :align "center")
         [(ui/with (map :grow 1) (ui/muted (preview-path)))
          (ui/button :focus-preview "Focus / F4" (fn [] (toggle-preview-focus)))])
       (ui/custom (map :grow 1)
         (fn [p s]
           (let [cw (get :canvas-width) ch (get :canvas-height)
                 scale (min (/ (nth s 0) cw) (/ (nth s 1) ch))
                 sw (* cw scale) sh (* ch scale)]
             (when (> scale 0)
               (surface [(+ (nth p 0) (/ (- (nth s 0) sw) 2))
                         (+ (nth p 1) (/ (- (nth s 1) sh) 2))] [sw sh])))))]))))

(defn inspector-fields-content [p s]
  (let [fields (scene-fields) x (nth p 0) y (nth p 1) width (nth s 0) height (nth s 1)
        offset (ui-inspector-scroll :scene-inspector-scroll :scene-inspector-offset x y width height (* (count fields) (get :ui-field-height)))
        first (floor (/ offset (get :ui-field-height)))
        last (min (count fields) (+ first 2 (floor (/ height (get :ui-field-height)))))]
    (scope (clip p [(max 0 (- width 16)) height])
      (mapv (fn [i]
        (scene-inspector-field (nth fields i) x (+ y (* i (get :ui-field-height)) (- 0 offset)) (max 1 (- width 16))))
        (slice (range (count fields)) first last)))
    (when (= (count fields) 0) (fill (get :ui-muted)) (text p "No state fields yet"))))

(defn inspector-pane-content [origin size]
  (if (get :inspector-collapsed)
    (asset-icon "scene" (+ (nth origin 0) 12) (+ (nth origin 1) 12))
    (ui/render origin size
      (ui/column (map :padding 16 :gap 12)
        [(ui/muted (preview-path))
         (ui/custom (map :grow 1) inspector-fields-content)
         (if (and (not (= (get :scene-edit-key) "")) (not (= (scene-edit-kind) "color")))
           (ui/row (map)
             [(ui/with (map :grow 1) (ui/code :__sceneValue))
              (ui/button :scene-inspector-apply "Apply" (fn [] (apply-scene-field)))]) nil)]))))

(defn docked-workspace [w h]
  (let [game-centered (and (get :show-game)
          (= (lookup (lookup (get :ui-docks) :game (map)) :dock "center") "center"))]
  (ui/dockspace :ui-docks [0 51] [w (max 0 (- h 81))]
    [(ui/pane :files "Project files"
       (map :dock "left" :extent (get :ui-files-width) :visible (get :show-files)
            :icon "folder" :hide-id :close-files :hide (fn [] (set! :show-files false))
            :collapsed (get :files-collapsed) :collapse-id :collapse-files
            :collapse (fn [] (set! :files-collapsed (not (get :files-collapsed)))))
       (ui/custom (map) (fn [p s] (file-explorer-body (nth p 0) (nth p 1) (nth s 0) (nth s 1) false))))
     (ui/pane :code "Code editor"
       (map :dock (if game-centered "left" "center") :extent (get :ui-code-fraction) :visible (get :show-code)
            :icon "code" :hide-id :close-code :hide (fn [] (set! :show-code false))
            :collapsed (get :code-collapsed) :collapse-id :collapse-code
            :collapse (fn [] (set! :code-collapsed (not (get :code-collapsed)))))
       (ui/custom (map) code-pane-content))
     (ui/pane :inspector "Scene inspector"
       (map :dock "right" :extent (get :ui-inspector-width) :visible (get :show-tools)
            :icon "scene" :hide-id :close-inspector :hide (fn [] (set! :show-tools false))
            :collapsed (get :inspector-collapsed) :collapse-id :collapse-inspector
            :collapse (fn [] (set! :inspector-collapsed (not (get :inspector-collapsed)))))
       (ui/custom (map) inspector-pane-content))
     (ui/pane :game "Game"
       (map :dock "center" :visible (get :show-game)
            :icon "game" :hide-id :close-game :hide (fn [] (set! :show-game false))
            :collapsed (get :game-collapsed) :collapse-id :collapse-game
            :collapse (fn [] (set! :game-collapsed (not (get :game-collapsed)))))
       (ui/custom (map) game-pane-content))
     (ui/pane :generator (if (get :show-generator) (generator-title) "Generators")
       (map :dock "floating" :visible (get :show-generator)
            :icon "generator"
            :collapsed (get :generator-collapsed) :collapse-id :collapse-generator
            :collapse toggle-generator-collapse
            :hide-id :close-generator :hide-label "X" :hide (fn [] (close-generator)))
       (ui/custom (map) generator-pane-content))])))
