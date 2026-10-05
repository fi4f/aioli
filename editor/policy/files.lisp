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
