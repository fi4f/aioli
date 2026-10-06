; Pure transitions return patches. The host applies them and performs browser effects.
(defn editor-source-key [path] (lookup (map :main.lisp "main" :game.lisp "game") path path))
(defn editor-source-path [key] (lookup (map :main "main.lisp" :game "game.lisp") key key))
(defn editor-code-open [workspace sources path width]
  (merge (editor-open-tab workspace sources (editor-source-key path))
    (map :show-code true :show-files (if (< width (lookup workspace :ui-narrow-width 850)) false (lookup workspace :show-files false))
      :file-path-editing false :selected-file path :window "")))
(defn editor-file-open [workspace sources assets path width]
  (if (contains? sources (editor-source-key path))
    (if (= (editor-source-role path) "generator") (map :action "generator")
      (map :action "code" :state (editor-code-open workspace sources path width)))
    (if (contains? assets path) (map :action "asset" :state (map :selected-file path))
      (error (str "Missing file " path)))))
(defn editor-generator-reset []
  (map :inspector-offset 0 :inspector-edit-key "" :text-preview-offset 0 :text-preview-x 0))
(defn editor-generator-show [workspace sources path width height]
  (let [w (min 560 (max 120 (- width 32))) h (min 680 (max 80 (- height 100)))
        placements (lookup workspace :ui-docks (map)) tree (lookup placements :_tree)
        docks (if (= tree nil) placements (assoc placements :_tree (dock-remove tree "generator")))
        pane (map :dock "floating" :x (/ (- width w) 2) :y (max 51 (+ 51 (/ (- height 81 h) 2)))
          :width w :height h :z (+ 1 (dock-highest-z placements)))
        state (map :window "" :show-generator true :generator-collapsed false :preview-focused false
          :inspector-edit-key "" :ui-docks (assoc docks :generator pane))]
    (if (and (not (= path "")) (contains? sources (editor-source-key path)))
      (merge state (editor-open-tab workspace sources (editor-source-key path)) (map :show-code true)) state)))
(defn editor-generator-code [workspace sources width]
  (let [path (lookup workspace :active-generator "")]
    (if (= path "") (map)
      (merge (editor-open-tab workspace sources (editor-source-key path))
        (map :show-code true :inspector-edit-key "" :show-generator
          (if (< width (lookup workspace :ui-narrow-width 850)) false (lookup workspace :show-generator false)))))))
(defn editor-next-generator [paths workspace]
  (let [files (editor-generator-paths paths)]
    (if (= (count files) 0) "" (nth files (mod (+ (index-of files (lookup workspace :active-generator)) 1) (count files))))))
(defn editor-field-edit [fields state key scope]
  (let [field (lookup (filter (fn [field] (= (lookup field :key) key)) fields) 0)]
    (when (= field nil) (error (str "Unknown " scope " field")))
    (let [value (lookup state key) buffer (if (contains? ["object" "nil"] (type value)) (json-write value) (str value))]
      (map :state (map (if (= scope "scene") "scene-edit-key" "inspector-edit-key") key)
        :buffer buffer :color (= (lookup field :kind) "color") :value value))))
(defn editor-preview-focus [workspace]
  (map :preview-focused (not (lookup workspace :preview-focused false)) :menu false))
(defn editor-recovery-state []
  (map :tab "main" :show-code true :preview-focused false :show-tools false :file-path-editing false :menu false :window ""))
(defn editor-context [workspace row x y]
  (let [path (lookup row :resourcePath "") kind (if (= (lookup row :resourceKind) "folder") "folder" (if (= path "") "" "file"))]
    (if (or (not (= (lookup workspace :window "") "")) (lookup workspace :menu false)
            (and (= path "") (not (= (lookup row :id) "files-tree")))) nil
      (merge (map :context-path path :context-kind kind :context-x x :context-y y :file-context true)
        (if (= kind "file") (map :selected-file path) (map))))))
(defn editor-save-file-path [workspace sources assets input-tab]
  (if (contains? ["image-asset" "audio-asset"] (lookup workspace :window)) (lookup workspace :preview-path "")
    (if (and (lookup workspace :show-generator) (= input-tab "__generatorValue")) (lookup workspace :active-generator "")
      (let [tab (lookup workspace :tab "")]
        (if (and (contains? sources tab) (not (starts-with? tab "__"))) (editor-source-path tab)
          (if (contains? assets (lookup workspace :selected-file "")) (lookup workspace :selected-file) ""))))))
(defn editor-path-inside? [path folder] (or (= path folder) (starts-with? path (str folder "/"))))
(defn editor-folder-ancestors [path]
  (let [parts (split path "/")] (mapv (fn [i] (join (slice parts 0 (+ i 1)) "/")) (range (count parts)))))
(defn editor-folder-created [workspace path]
  (let [ancestors (editor-folder-ancestors path) folders (distinct (concat (lookup workspace :project-folders []) ancestors))]
    (when (> (count folders) 256) (error "Maximum 256 explicit folders"))
    (map :project-folders folders :open-folders (distinct (concat (lookup workspace :open-folders []) ancestors))
      :window "" :file-offset 0)))
(defn editor-folder-deleted [workspace path]
  (map :project-folders (filter (fn [folder] (not (editor-path-inside? folder path))) (lookup workspace :project-folders []))
       :open-folders (filter (fn [folder] (not (editor-path-inside? folder path))) (lookup workspace :open-folders []))
       :file-context false :window ""))
(defn editor-remap-state [state old-path new-path prefix]
  (let [remap (fn [value] (if (and (string? value) (if prefix (editor-path-inside? value old-path) (= value old-path)))
                (str new-path (slice value (count old-path))) value))]
    (reduce (fn [result key] (let [value (lookup state key)]
      (assoc result key (if (vector? value) (mapv remap value) (remap value))))) (map) (keys state))))
(defn editor-file-moved [workspace path]
  (let [parts (split path "/") folder (join (slice parts 0 -1) "/") expanded (lookup workspace :open-folders [])]
    (map :selected-file path :open-folders (if (or (= folder "") (contains? expanded folder)) expanded (conj expanded folder)))))
(defn editor-settings-open [settings]
  (map :buffers (map :__projectName (str (lookup settings :project-name)) :__canvasWidth (str (lookup settings :canvas-width))
                    :__canvasHeight (str (lookup settings :canvas-height)))
    :state (map :input-tab "" :project-settings-error "" :window "project-settings" :menu false)))
(defn editor-settings-request [buffers]
  (map :project-name (lookup buffers :__projectName) :canvas-width (parse-number (lookup buffers :__canvasWidth))
       :canvas-height (parse-number (lookup buffers :__canvasHeight))))

(defn editor-file-drop-folder [row header]
  (if (= (lookup row :resourceKind) "folder") (lookup row :resourcePath)
    (if (contains? row :resourcePath) (join (slice (split (lookup row :resourcePath) "/") 0 -1) "/")
      (if (or (= (lookup row :id) "files-tree") header) "" nil))))
(defn editor-folder-moved [workspace old-path new-path folders]
  (let [paths ["selected-file" "preview-path" "active-generator" "image-generator-path" "audio-generator-path"
               "text-generator-path" "context-path" "hook-path"]
        remapped (editor-remap-state (reduce (fn [out key]
          (if (contains? workspace key) (assoc out key (lookup workspace key)) out)) (map)
          (concat paths ["open-folders" "editor-file-paths"])) old-path new-path true)]
    (merge remapped (map :project-folders folders :open-folders
      (distinct (concat (lookup remapped :open-folders []) (editor-folder-ancestors new-path)))
      :window "" :file-context false :file-offset 0))))
(defn editor-upgrade-backup-path [stem sources resources index]
  (let [path (str stem "-backup-" index ".lisp")]
    (if (or (contains? sources path) (contains? resources path))
      (editor-upgrade-backup-path stem sources resources (+ index 1)) path)))
(defn editor-upgrade-plan [sources resources defaults editor-keys owned]
  (let [backups (filter (fn [key] (and (contains? sources key) (not (= (lookup sources key) (lookup defaults key))))) editor-keys)
        count-files (count (filter (fn [key] (not (starts-with? key "__"))) (keys sources)))]
    (when (> (+ count-files (count backups)) 256) (error "Make room for editor backups before upgrading"))
    (let [plan (reduce (fn [plan key]
            (let [files (lookup plan :sources) stem (replace-pattern key "\\.lisp$" "")
                  backup (editor-upgrade-backup-path stem files resources 1)]
              (map :sources (assoc files backup (lookup files key))
                   :owned (distinct (conj (lookup plan :owned) (editor-source-path backup))))))
          (map :sources sources :owned owned) backups)
          files (reduce (fn [files key] (assoc files key (lookup defaults key))) (lookup plan :sources) editor-keys)]
      (map :sources files :owned (lookup plan :owned)))))
(defn editor-text-mime [path]
  (let [parts (split path ".") suffix (lower-case (nth parts (- (count parts) 1)))]
    (str (lookup (map :json "application/json" :csv "text/csv" :html "text/html" :xml "application/xml"
                     :js "text/javascript" :css "text/css") suffix "text/plain") ";charset=utf-8")))

(defn editor-folder-validate [files existing folders path]
  (when (starts-with? path "__") (error "Names beginning with __ are reserved"))
  (when (> (count (filter (fn [file] (editor-path-inside? path file)) files)) 0) (error "A file already uses that path"))
  (when (contains? existing path) (error "Folder already exists"))
  (when (>= (count folders) 256) (error "Maximum 256 explicit folders"))
  path)
(defn editor-folder-move-plan [files existing folders old-path new-path]
  (when (not (contains? existing old-path)) (error "Missing folder"))
  (when (editor-path-inside? new-path old-path) (error "Cannot move a folder inside itself"))
  (editor-folder-validate files existing folders new-path)
  (let [remap (fn [path] (if (editor-path-inside? path old-path) (str new-path (slice path (count old-path))) path))
        moves (mapv (fn [path] [path (remap path)]) (filter (fn [path] (editor-path-inside? path old-path)) files))
        persisted (distinct (concat (mapv remap folders) (slice (editor-folder-ancestors old-path) 0 -1) (editor-folder-ancestors new-path)))]
    (when (> (count persisted) 256) (error "Maximum 256 explicit folders"))
    (map :moves moves :folders persisted)))
(defn editor-file-move-check [sources resources old-path new-path]
  (when (contains? ["main.lisp" "game.lisp"] old-path) (error "Keep the application entry filenames"))
  (when (starts-with? new-path "__") (error "Names beginning with __ are reserved"))
  (let [old-key (editor-source-key old-path) new-key (editor-source-key new-path)]
    (when (not (or (contains? sources old-key) (contains? resources old-path))) (error "Missing file"))
    (when (and (not (= old-path new-path)) (or (contains? sources new-key) (contains? resources new-path))) (error "Destination already exists"))
    (when (and (contains? sources old-key) (not (ends-with? new-path ".lisp"))) (error "Source files must end in .lisp"))))

(defn editor-play-request [path]
  (if (= path "main.lisp") (map :action "evaluate")
    (if (= path "game.lisp") (map :action "game" :options (map :restart true))
      (if (= (editor-source-role path) "scene") (map :action "game" :options (map :scene path))
        (error "Expected game.lisp or a scene file")))))
(defn editor-playable-file? [path sources]
  (and (or (contains? ["main.lisp" "game.lisp"] path) (= (editor-source-role path) "scene"))
    (contains? sources (editor-source-key path))))
(defn editor-file-editable? [path sources assets]
  (and (not (contains? ["main.lisp" "game.lisp"] path))
    (or (contains? sources (editor-source-key path)) (contains? assets path))))
(defn editor-file-destination [path files folders]
  (when (contains? folders path) (error "A folder already uses that path"))
  (when (> (count (filter (fn [file] (starts-with? path (str file "/"))) files)) 0)
    (error "A file already uses a parent path")))

(defn editor-file-create-check [sources resources path text]
  (when (starts-with? path "__") (error "Names beginning with __ are reserved for input buffers"))
  (when (or (contains? sources (editor-source-key path)) (contains? resources path)) (error (str "File already exists: " path)))
  (when (>= (count (filter (fn [key] (not (starts-with? key "__"))) (keys sources))) 256) (error "Maximum 256 source files"))
  (when (or (not (string? text)) (> (count text) 100000)) (error "Invalid source text")))

(defn editor-project-files [rows offset]
  (let [start (max 0 offset)]
    (mapv (fn [row] (slice row 0 3)) (slice (sort rows (fn [a b] (compare (nth a 0) (nth b 0)))) start (+ start 12)))))
