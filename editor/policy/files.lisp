; File roles are editor conventions. The runtime loads explicit paths.
(defn editor-source-role [path]
  (if (= path "main.lisp") "app"
    (if (ends-with? path ".scene.lisp") "scene"
      (if (ends-with? path ".generator.lisp") "generator"
        (if (ends-with? path ".command.lisp") "command" "module")))))
(defn editor-asset-kind [path kind mime]
  (if (= kind "lisp")
    (if (= path "main.lisp") "editor-entry"
      (if (= path "game.lisp") "main-entry"
        (let [role (editor-source-role path)] (if (= role "module") "code" role))))
    (if (starts-with? mime "image/") "image"
      (if (starts-with? mime "audio/") "audio"
        (if (matches? path "\\.(lisp|json|js|ts|wgsl|txt|md)$") "code"
          (if (matches? path "\\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)$") "image"
            (if (matches? path "\\.(wav|mp3|ogg|flac|m4a|aac)$") "audio" "asset")))))))
(defn editor-command-file? [path kind]
  (and (= kind "lisp") (= (editor-source-role path) "command")))
(defn editor-toggle-folder [expanded path]
  (sort (if (contains? expanded path)
    (filter (fn [item] (not (= item path))) expanded)
    (conj expanded path))))
(defn editor-tab-valid? [key sources]
  (and (string? key) (not (= key "")) (not (starts-with? key "__"))
       (or (contains? sources key) (contains? ["wgsl" "guide" "diagnostic"] key))))
(defn editor-open-tabs [workspace sources]
  (let [fallback (filter (fn [key] (contains? sources key)) ["main" "game"])
        saved (lookup workspace :open-tabs fallback)
        tabs (distinct (filter (fn [key] (editor-tab-valid? key sources)) (if (vector? saved) saved fallback)))
        active (lookup workspace :tab "")]
    (if (and (editor-tab-valid? active sources) (not (contains? tabs active))) (conj tabs active) tabs)))
(defn editor-open-tab [workspace sources key]
  (when (not (editor-tab-valid? key sources)) (error (str "Unknown source buffer " key)))
  (let [tabs (editor-open-tabs workspace sources)]
    (map :open-tabs (if (contains? tabs key) tabs (conj tabs key)) :tab key :tab-last "")))
(defn editor-close-tab [workspace sources key]
  (let [tabs (editor-open-tabs workspace sources) index (index-of tabs key)
        next (filter (fn [item] (not (= item key))) tabs)]
    (map :open-tabs next :tab (if (= (lookup workspace :tab "") key)
      (lookup next (min index (- (count next) 1)) "") (lookup workspace :tab "")))))
(defn editor-rename-tab [workspace sources old-key new-key]
  (let [tabs (lookup workspace :open-tabs [])
        renamed (mapv (fn [key] (if (= key old-key) new-key key)) (if (vector? tabs) tabs []))
        active (lookup workspace :tab "")
        next (map :open-tabs renamed :tab (if (= active old-key) new-key active))]
    (assoc next :open-tabs (editor-open-tabs next sources))))
(defn editor-generator-paths [paths]
  (sort (filter (fn [path] (= (editor-source-role path) "generator")) paths)))
(defn editor-selected-generator [programs workspace]
  (lookup (filter (fn [program] (= (lookup program :path) (lookup workspace :active-generator))) programs) 0 (lookup programs 0)))
(defn editor-output-generator [programs workspace output]
  (let [selected (editor-selected-generator programs workspace)
        preferred (lookup workspace (str output "-generator-path"))]
    (if (= (lookup selected :output) output) selected
      (lookup (filter (fn [program] (= (lookup program :path) preferred)) programs) 0
        (lookup (filter (fn [program] (= (lookup program :output) output)) programs) 0)))))

(defn editor-file-dialog [workspace rename]
  (let [context (lookup workspace :context-path "") kind (lookup workspace :context-kind "")
        parent (if (= kind "folder") (str context "/")
          (if (= kind "file") (join (slice (split context "/") 0 -1) "/") ""))
        directory (if (or (= kind "folder") (= parent "")) parent (str parent "/"))
        state (map :file-operation (if rename "rename" "create") :file-path-editing false
          :file-context false :window "file-path")]
    (map :input (if rename (lookup workspace :selected-file) (str directory "new.lisp"))
      :state (if rename state (assoc (assoc state :new-file-type "script") :new-generator-output "image")))))
(defn editor-folder-dialog [workspace operation]
  (let [context (lookup workspace :context-path "")
        parent (if (= (lookup workspace :context-kind "") "folder") (str context "/")
          (let [directory (join (slice (split context "/") 0 -1) "/")]
            (if (= directory "") "" (str directory "/"))))]
    (map :input (if (= operation "create") (str parent "new-folder") context)
      :state (map :folder-source context :file-operation (str "folder-" operation)
        :file-context false :window "file-path" :file-path-editing false))))
(defn editor-new-file-path [path kind]
  (when (not (string? path)) (error "Enter a file name"))
  (let [path (trim path) suffix (lookup (map :script ".lisp" :scene ".scene.lisp"
            :generator ".generator.lisp" :command ".command.lisp") kind)]
    (if (or (= path "") (= kind "none")) path
      (do (when (= suffix nil) (error "Unknown file type"))
        (str (replace-pattern path "(?:\\.(?:scene|generator|command))?\\.lisp$" "") suffix)))))
(defn editor-new-file-code [kind output]
  (let [template (if (= kind "generator") (str output "-generator") kind)]
    (if (= kind "none") ""
      (do (when (not (contains? ["scene" "script" "command" "image-generator" "audio-generator" "text-generator"] template))
            (error "Unknown file type or generator output"))
        (project-text (str "editor/templates/" template ".lisp"))))))
(defn editor-palette-commands [paths query]
  (let [query (lower-case (trim query))]
    (slice (sort (filter (fn [path] (and (= (editor-source-role path) "command")
      (or (= query "") (includes? (lower-case path) query)))) paths)) 0 8)))

; Fit whole tabs. The returned patch makes layout queries explicit and testable.
(defn editor-tab-label [key]
  (if (contains? ["main" "game"] key) key
    (let [parts (split key "/")] (nth parts (- (count parts) 1)))))
(defn editor-tab-width [key] (min 192 (max 64 (+ (* (count (editor-tab-label key)) 8) 48))))
(defn editor-tab-start [widths start active available]
  (let [total (reduce + 0 (slice widths start (+ active 1)))
        result (reduce (fn [result i]
          (if (> (nth result 1) available) [(+ i 1) (- (nth result 1) (nth widths i))] result))
          [start total] (slice (range active) start))]
    (nth result 0)))
(defn editor-tab-rows [tabs widths sources committed start available x limit]
  (if (or (>= start (count tabs)) (= available 0) (= limit 0)) []
    (let [width (min (nth widths start) available) key (nth tabs start)]
      (if (> (+ x width) available) []
        (concat [[key (editor-tab-label key) x width
          (and (contains? sources key) (not (= (lookup sources key) (lookup committed key))))]]
          (editor-tab-rows tabs widths sources committed (+ start 1) available (+ x width) (- limit 1)))))))
(defn editor-tab-layout [workspace sources committed width]
  (let [tabs (editor-open-tabs workspace sources) widths (mapv editor-tab-width tabs)
        available (max 64 (- width 48)) offset (lookup workspace :tab-offset 0)
        start (max 0 (min (- (count tabs) 1) (if (number? offset) (floor offset) 0)))
        active (index-of tabs (lookup workspace :tab))
        next (if (and (>= active 0) (or (not (= (lookup workspace :tab-last) (lookup workspace :tab)))
                                      (not (= (lookup workspace :tab-width) width))))
          (editor-tab-start widths (min start active) active available) start)
        rows (slice (editor-tab-rows tabs widths sources committed next available 0 64) 0 64)]
    (map :rows rows :before (> next 0) :after (< (+ next (count rows)) (count tabs))
      :state (map :open-tabs tabs :tab-last (lookup workspace :tab "") :tab-width width :tab-offset next))))
