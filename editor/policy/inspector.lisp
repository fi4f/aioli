; Annotations are data. Control choices and limits belong to the editor.
(defn editor-inspector-kind [value]
  (if (number? value) "number"
    (if (boolean? value) "boolean"
      (if (string? value) (if (matches? value "^#[0-9a-f]{6}$") "color" "text") "data"))))
(defn editor-inspector-field [info]
  (let [key (lookup info :key) value (lookup info :value) path (lookup info :path)
        annotation (lookup info :annotation []) kind (editor-inspector-kind value)
        label (lookup annotation 0 key) choices (lookup annotation 1 nil)]
    (when (or (not (vector? annotation)) (> (count annotation) 4) (not (string? label)))
      (error (str path ": use [\"Label\" min max step] or [\"Label\" [choices...]]")))
    (when (and (not (= kind "number")) (not (vector? choices)) (> (count annotation) 1))
      (error (str path ": numeric bounds only apply to numeric state")))
    (if (vector? choices)
      (do
        (when (= (count choices) 0) (error (str path ": inspector choices cannot be empty")))
        (when (or (not (= (count annotation) 2)) (not (contains? choices value))
                  (not (= (count (filter (fn [choice] (= (type choice) (type value))) choices)) (count choices))))
          (error (str path ": choices must include the default and match its type")))
        (map :key key :label label :kind "choice" :low 0 :high 1 :step 1 :choices choices :value value))
      (if (= kind "number")
        (let [spread (max 1 (abs value)) low (lookup annotation 1 (min 0 (- value spread)))
              high (lookup annotation 2 (max 1 (+ value spread))) step (lookup annotation 3 (if (integer? value) 1 0.01))]
          (when (or (not (number? low)) (not (number? high)) (not (number? step))
                    (>= low high) (<= step 0)
                    (and (not (lookup info :computed false)) (or (< value low) (> value high))))
            (error (str path ": invalid slider bounds/default/step for " key)))
          (map :key key :label label :kind kind :low low :high high :step step :choices [] :value value))
        (map :key key :label label :kind kind :low 0 :high 1 :step 1 :choices [] :value value)))))
(defn editor-inspector-fields [declarations]
  (let [literal (filter (fn [info]
        (or (not (lookup info :computed)) (> (count (lookup info :annotation)) 0))) declarations)
        fields (mapv editor-inspector-field literal)]
    (when (not (= (count fields) (count (distinct (mapv (fn [field] (lookup field :key)) fields)))))
      (error "Duplicate inspector field"))
    (when (> (count fields) 64) (error "Maximum 64 inspector fields"))
    fields))
(defn editor-field-row [field]
  [(lookup field :key) (lookup field :label) (lookup field :kind) (lookup field :low)
   (lookup field :high) (lookup field :step) (lookup field :choices)])
(defn editor-live-fields [declared state owned]
  (let [known (mapv (fn [field] (lookup field :key)) declared)
        fresh (filter (fn [key] (and (contains? state key) (not (contains? known key))
          (not (contains? ["active-scene" "entry-scene-request"] key)))) owned)
        fields (concat declared (mapv (fn [key]
          (editor-inspector-field (map :key key :value (lookup state key) :path "live state" :annotation []))) fresh))]
    (filter (fn [field] (contains? state (lookup field :key))) fields)))

(defn editor-field-value [field value]
  (let [kind (lookup field :kind)]
    (if (= kind "number")
      (do (when (not (number? value)) (error "Inspector number must be finite"))
        (let [low (lookup field :low) high (lookup field :high) step (lookup field :step)]
          (clamp (precision (+ low (* (round (/ (- value low) step)) step)) 12) low high)))
      (do
        (when (and (= kind "choice") (not (contains? (lookup field :choices) value))) (error "Unknown inspector choice"))
        (when (and (= kind "boolean") (not (boolean? value))) (error "Expected a boolean"))
        (when (and (contains? ["color" "text"] kind) (not (string? value))) (error "Expected text"))
        (when (and (= kind "color") (not (matches? value "^#[0-9a-f]{6}$"))) (error "Expected #RRGGBB"))
        (if (and (= kind "data") (string? value)) (json-read value) value)))))
(defn editor-generator-info [path declarations definitions]
  (when (> (count declarations) 1) (error (str path ": expected one generator declaration")))
  (let [declaration (lookup declarations 0 [])
        names (mapv (fn [info] (lookup info :name)) definitions)
        output (lookup declaration 0 (if (contains? names "render") "image"
          (if (contains? names "generate-text") "text" "audio")))
        title (lookup declaration 1 (lookup (split path "/") (- (count (split path "/")) 1)))
        filename (lookup declaration 2 "generated.txt")]
    (when (not (contains? ["image" "audio" "text"] output)) (error (str path ": generator output must be image, audio or text")))
    (when (or (> (count declaration) (if (= output "text") 3 2)) (not (string? title)) (not (string? filename)))
      (error (str path ": invalid generator declaration")))
    (map :path path :output output :title title :filename filename)))
(defn editor-preview-info [info]
  (let [annotation (lookup info :annotation) name (lookup info :name) params (lookup info :params)
        title (lookup annotation 0 name) defaults (lookup annotation 1 (mapv (fn [param] 0) params))
        size (lookup annotation 2 [320 240])]
    (when (or (> (count annotation) 3) (not (string? title))) (error "Hook annotation: [title [argument defaults] [canvas width height]]"))
    (when (or (not (vector? defaults)) (not (= (count defaults) (count params)))) (error (str name ": preview defaults must match arguments")))
    (when (or (not (vector? size)) (not (= (count size) 2))
      (not (= (count (filter (fn [n] (and (integer? n) (>= n 1) (<= n 4096))) size)) 2)))
      (error (str name ": canvas dimensions must be integers from 1 to 4096")))
    (map :name name :kind (lookup info :kind) :title title :params params :defaults defaults :size size
      :bodyOffset (lookup info :bodyOffset))))
