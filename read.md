# AgentShell MCP — Claude Code ve Cursor Agent Kurulum Rehberi

Bu belge, Claude Code ve Cursor Agent'ın aynı yerel AgentShell Runtime'a MCP üzerinden bağlanmasını ve AgentShell araçlarını güvenli, gözlemlenebilir biçimde kullanmasını anlatır.

Amaç şudur:

- AI tarafından başlatılan komutlar normal terminal süreçleri olarak kaybolmasın.
- Her komut AgentShell içinde bir `Run` olarak izlensin.
- stdout, stderr, process tree, port, durum ve kaynak kullanımı Dashboard'da görülebilsin.
- Tekrar kullanılacak komutlar Project, Collection, Launcher ve Stack olarak düzenlenebilsin.
- Claude Code ile oluşturulan bir launcher Cursor tarafından da görülebilsin ve çalıştırılabilsin.

## 1. Temel kavramlar

| Kavram | Anlamı | Örnek |
| --- | --- | --- |
| Runtime | Süreçleri gerçekten başlatan ve izleyen yerel AgentShell servisi | `http://127.0.0.1:4242` |
| MCP bridge | AI istemcisinin stdio üzerinden başlattığı ince köprü süreci | `agentshell mcp` |
| Project | Fiziksel çalışma alanı ve kök klasör | `AgentShell → /Users/sezgin.kahraman/AgentShell` |
| Collection | Bir Project içindeki isteğe bağlı düzenleme klasörü | `Internal Services`, `Tests`, `Build` |
| Launcher | Daha sonra tekrar çalıştırılabilecek kayıtlı service veya task komutu | `make go`, `npm test` |
| Stack | Birden fazla launcher'ın isimlendirilmiş grubu | `Internal Microservices` |
| Run | Bir komutun belirli bir çalıştırma örneği | PID, log, port ve exit code taşıyan kayıt |
| History | Tamamlanmış ve çalışan Run geçmişi | Başlatma, test ve build kayıtları |

`Project` ve `Collection` aynı şey değildir:

- Project bir gerçek workspace/root klasörünü temsil eder.
- Collection yalnızca o projenin katalog içindeki düzenleme klasörüdür.
- `Project launchers`, launcher'ın bir Project'e ait olduğu fakat isteğe bağlı bir Collection seçilmediği kök alanıdır.
- `Global catalog`, belirli bir Project'e bağlı olmayan launcher'lar içindir.

## 2. Bağlantı mimarisi

```text
Claude Code ─┐
             ├─ stdio MCP ─> agentshell mcp ─┐
Cursor Agent ┘                               │
                                             ▼
                              AgentShell Runtime :4242
                                             │
                    ┌────────────────────────┼──────────────────────┐
                    ▼                        ▼                      ▼
                Processes              Logs / Ports          SQLite Catalog
```

Önemli davranışlar:

1. Runtime ve MCP bridge farklı süreçlerdir.
2. `agentshell mcp` Runtime'ı başlatmaz ve sahiplenmez.
3. Runtime önce kullanıcı tarafından çalıştırılmalıdır.
4. Claude Code ve Cursor Agent kendi bridge süreçlerini ayrı ayrı açar.
5. Her bridge aynı Runtime ve aynı SQLite kataloğunu kullanır.
6. Gerçek MCP initialization tamamlandığında istemci Dashboard'da bağlı görünür.
7. İstemci kapandığında veya bridge çöktüğünde lease süresi dolar ve sahte bağlantı durumu gösterilmez.

MCP bridge, tool çağrılarını localhost üzerindeki AgentShell HTTP API'sine iletir. Komutun process group yönetimini, log dosyalarını, port keşfini ve kalıcı durumunu Runtime gerçekleştirir.

## 3. Ön koşullar

AgentShell proje dizini:

```text
/Users/sezgin.kahraman/AgentShell
```

Binary yolu:

```text
/Users/sezgin.kahraman/AgentShell/bin/agentshell
```

Önce projeyi build edip Runtime'ı başlatın:

```bash
cd /Users/sezgin.kahraman/AgentShell
./start.sh
```

Dashboard:

```text
http://127.0.0.1:4242
```

Runtime kontrolü:

```bash
curl -fsS http://127.0.0.1:4242/api/runtime
```

Runtime çalışmadan MCP istemcisini başlatırsanız bridge bilinçli olarak hata verip çıkar. MCP bridge'in eski veya yanlış bir Runtime kaydına sessizce bağlanması beklenmez.

## 4. Claude Code bağlantısı

Claude Code, AgentShell'i yerel bir stdio MCP server olarak çalıştırır.

### 4.1. Bu makine için önerilen kurulum

AgentShell dizininde şu komutu çalıştırın:

```bash
cd /Users/sezgin.kahraman/AgentShell

claude mcp add --scope local --transport stdio agentshell -- \
  /Users/sezgin.kahraman/AgentShell/bin/agentshell mcp \
  -workspace-root /Users/sezgin.kahraman/AgentShell \
  -client-name "Claude Code"
```

Bu seçim:

- Sadece bu makinedeki kullanıcıyı etkiler.
- AgentShell kaydını mevcut proje bağlamına ekler.
- Makineye özel absolute path'i repoya yazmaz.
- Dashboard'da fallback istemci adı olarak `Claude Code` kullanılmasını sağlar.

Bağlantıyı kontrol edin:

```bash
claude mcp list
claude mcp get agentshell
```

Claude Code oturumu içinde:

```text
/mcp
```

Gerekirse Claude Code oturumunu kapatıp yeniden açın.

### 4.2. Takımla paylaşılabilen proje yapılandırması

Claude Code için proje kapsamlı MCP tanımı repo kökündeki `.mcp.json` dosyasında tutulabilir:

```json
{
  "mcpServers": {
    "agentshell": {
      "command": "/Users/sezgin.kahraman/AgentShell/bin/agentshell",
      "args": [
        "mcp",
        "-workspace-root",
        "/Users/sezgin.kahraman/AgentShell",
        "-client-name",
        "Claude Code"
      ]
    }
  }
}
```

Aynı kayıt CLI ile `--scope project` kullanılarak da oluşturulabilir. Project-scoped MCP server ilk kullanımda güven onayı isteyebilir.

Bu JSON içindeki absolute yollar makineye özeldir. Dosya takımla paylaşılacaksa iki seçenek vardır:

- AgentShell binary'sini herkesin `PATH` ortamında bulunan kararlı bir konuma kurmak ve `command` alanını `agentshell` yapmak.
- Her geliştiricinin kendi local MCP kaydını oluşturmasını sağlamak ve `.mcp.json` dosyasını repoya koymamak.

### 4.3. Claude Code için önerilen talimat

Aşağıdaki metin proje `CLAUDE.md` dosyasına eklenebilir:

```md
## AgentShell runtime policy

- Long-running services, builds, tests, migrations and scripts should be run through AgentShell MCP tools when available.
- At the beginning of an AgentShell workflow, call `get_runtime` and `get_workspace_context`.
- Use `inspect_project` only for read-only discovery. Do not execute discovered candidates automatically.
- For a complete project catalog, call `apply_catalog` with `dry_run: true` first. Apply only after reviewing the preview.
- Saving a project, collection, command or stack must not implicitly start it.
- Use `kind: service` for long-running processes and `kind: task` for finite commands.
- Before starting a saved service, call `list_commands` or `list_runs` and preserve `already_running` results.
- Do not infer stable expected ports from one observation. Include a port only when it is known to be part of the command contract.
- Never call `shutdown_runtime`, delete catalog records, or stop unrelated runs unless the user explicitly requests it.
- Report created/reused IDs, run status, ports and log results clearly.
- If a launcher needs user input, define a parameters schema. Never save a real
  secret in command, env, default, description, tags, or catalog metadata. For
  credentials use a secret field with stdin binding and prefer dashboard entry
  over asking the user to paste a secret into chat.
```

## 5. Cursor Agent bağlantısı

Cursor da AgentShell'i yerel stdio MCP server olarak çalıştırır.

### 5.1. Projeye özel Cursor yapılandırması

Repo kökünde `.cursor/mcp.json` oluşturun:

```json
{
  "mcpServers": {
    "agentshell": {
      "command": "/Users/sezgin.kahraman/AgentShell/bin/agentshell",
      "args": [
        "mcp",
        "-workspace-root",
        "/Users/sezgin.kahraman/AgentShell",
        "-client-name",
        "Cursor"
      ]
    }
  }
}
```

Sonra:

1. Cursor'u yeniden yükleyin.
2. `Settings → Tools & MCP` bölümünü açın.
3. `agentshell` server'ının bulunduğunu kontrol edin.
4. Server disabled görünüyorsa etkinleştirin.
5. Cursor Chat'i `Agent` modunda kullanın.
6. Available Tools içinde AgentShell tool'larının geldiğini doğrulayın.

Global kullanım istenirse aynı yapılandırma `~/.cursor/mcp.json` içine konabilir. Ancak `workspace-root` belirli bir proje yoluna sabitlendiği için proje bazlı `.cursor/mcp.json` daha güvenlidir.

Cursor workspace değişkenlerinin MCP argümanlarında sürümler arasında farklı davranma ihtimali olduğundan ilk kurulumda absolute path kullanılması önerilir.

### 5.2. Cursor Agent için önerilen rule

Aşağıdaki metin bir Cursor project rule içine eklenebilir:

```md
Use AgentShell MCP for commands that should remain observable after the chat turn.

Workflow:
1. Verify AgentShell with `get_runtime`.
2. Read the explicit root with `get_workspace_context`.
3. Discover commands with `inspect_project`; this is read-only.
4. Prefer `apply_catalog(dry_run=true)` before creating a full project catalog.
5. Saving catalog entries never authorizes starting them.
6. Start only the services/tasks explicitly requested by the user.
7. Read stdout/stderr with `get_logs` and report exit state and listening ports.
8. Never duplicate an already-running service.
9. Never stop the Runtime or delete records without explicit user intent.
10. Configure runtime input schemas when needed, but never persist or guess
    secret values. Prefer asking the user to complete the AgentShell dashboard
    prompt.
```

### 5.3. Cursor bağlantı testi

Cursor Agent'a şu prompt verilebilir:

```text
AgentShell MCP bağlantısını kontrol et.
Önce get_runtime ve get_workspace_context çağır.
Hiçbir komut çalıştırma ve hiçbir katalog kaydı oluşturma.
Gördüğün Runtime kimliğini, workspace root'u ve kullanılabilir AgentShell araçlarını özetle.
```

## 6. Claude Code ve Cursor aynı anda bağlandığında

İki istemci aynı anda kullanılabilir. Beklenen süreç görünümü kabaca şöyledir:

```text
agentshell server
├── agentshell mcp -client-name "Claude Code"
└── agentshell mcp -client-name "Cursor"
```

Gerçekte MCP bridge süreçleri istemciler tarafından yönetilir; Runtime'ın child process'i olmak zorunda değildir.

Dashboard bağlantı alanında şunlar görünmelidir:

```text
Runtime running
2 MCP clients
Claude Code
Cursor
```

Her iki istemci de aynı verilere erişir:

- Aynı Projects ve Collections
- Aynı saved launchers
- Aynı Stacks
- Aynı Run History
- Aynı log ve port bilgileri

Örneğin Claude Code'un oluşturduğu `Internal Microservices` stack'i Cursor tarafından `list_stacks` ile bulunup başlatılabilir.

## 7. Agent çalışma sözleşmesi

AgentShell kullanan bir AI agent'ın önerilen işlem sırası şöyledir:

### 7.1. Oturum başlangıcı

1. `get_runtime` ile Runtime durumunu doğrula.
2. `get_workspace_context` ile explicit workspace root'u oku.
3. `configured: false` dönerse çalışma klasörünü tahmin etme.
4. İlgili katalog durumunu `list_projects`, `list_collections`, `list_commands` ve `list_stacks` ile incele.

### 7.2. Proje keşfi

1. `inspect_project` çağır.
2. Dönen candidate, evidence, confidence ve warning alanlarını incele.
3. Makefile, package.json, Go command, Compose veya shell script bulunması o komutu çalıştırma izni değildir.
4. Background süreç, `nohup`, `disown`, `&` veya `docker compose up -d` warning'lerini kullanıcıya göster.
5. Komutları service/task olarak doğru sınıflandır.

### 7.3. Katalog oluşturma

Tam bir proje düzeni için önerilen yol:

1. `apply_catalog` çağrısını `dry_run: true` ile yap.
2. Oluşturulacak/reuse edilecek Project, Collection, Command ve Stack kayıtlarını gözden geçir.
3. Kullanıcı isteğiyle uyumluysa aynı payload'ı `dry_run: false` ile uygula.
4. Sonuçtaki `created`, `updated` ve `reused` durumlarını raporla.

`apply_catalog` atomik ve idempotent kullanım için tasarlanmıştır. Bir conflict oluşursa yarım katalog bırakmamalıdır.
Project, Collection ve birden fazla launcher birlikte istenmişse ayrı ayrı `save_*` çağrıları yerine bu akış tercih edilmelidir. Ayrı çağrılar kullanılıyorsa `save_collection` sonucundaki ID, ilgili her `save_command`/`update_command` ve `save_stack`/`update_stack` çağrısına `collection_id` olarak açıkça verilmelidir; atama sonrasında liste araçlarıyla doğrulanmalıdır.

### 7.4. Çalıştırma

- Uzun yaşayan web server, API, worker veya database launcher'ı için `kind: service` kullan.
- Foreground process AgentShell tarafından sahiplenilecekse `lifecycle_mode: managed` kullan; ayrıca stop launcher oluşturma.
- `docker compose up -d`, `docker start`, `nohup` veya daemon mode gibi detached kaynaklarda `lifecycle_mode: external` ve aynı launcher üzerinde `stop_command` kullan. Ayrı bir “Stop” launcher oluşturma.
- External launcher için `restart_command` isteğe bağlıdır; verilmezse AgentShell stop ardından start komutunu çalıştırır. `expected_ports` tanımlıysa AgentShell start öncesi port durumunu kaydeder: önce kapalı, sonra dinliyor olan port `external verified`; önceden açık olan port `pre-existing`; süre sonunda açılmayan port `unavailable` olur. Sonrasında current health periyodik kontrol edilir; doğrulanmış bir port kapanırsa `list_ports`tan çıkar fakat geçiş kanıtı geçmişte korunur. Bu doğrulama port sağlığını kanıtlar, process ownership iddiasında bulunmaz.
- Build, test, lint, migration ve kısa script için `kind: task` kullan.
- Doğrudan yeni komut için `run` kullan.
- Kayıtlı launcher için `start_command` kullan.
- Bir grup launcher için `start_stack` kullan. Yalnız belirli stack üyeleri istenmişse aynı çağrıda `command_ids` alt kümesini ver; AgentShell seçilen üyelerin transitif `depends_on` bağımlılıklarını otomatik olarak dahil eder.
- Servis başlatmadan önce duplicate durumunu kontrol et.
- `wait_for: ready`, yalnız readiness için bilinen expected port varsa anlamlıdır.
- Doğrudan `run`/command çağrısındaki `wait_timeout_ms`, MCP yanıtının bekleme süresidir. Stack member üzerindeki `wait_timeout_ms` ise o member'ın orchestration koşulunun gerçek timeout'udur.
- `run_timeout_ms`, çalışan komutun maksimum yaşam süresidir.

#### Runtime parametreleri ve secret girdileri

Yalnız kayıtlı launcher'lar bir parameters şeması taşıyabilir. Bu şema değeri
değil, panelde gösterilecek alanı tarif eder:

    {
      "name": "Vault unseal",
      "command": "docker exec -i hotel-vault vault operator unseal -",
      "cwd": "/absolute/path/to/project",
      "kind": "task",
      "parameters": [
        {
          "key": "unseal_key",
          "label": "Vault unseal key",
          "description": "Bu Run için yalnız stdin üzerinden kullanılır.",
          "type": "secret",
          "required": true,
          "binding": "stdin",
          "append_newline": false
        }
      ]
    }

Desteklenen türler text, secret, number, boolean ve choice; binding türleri
stdin ve env'dir. Env seçildiğinde env_var zorunludur. Bir launcher'da en fazla
bir stdin parametresi olabilir. Choice için options gerekir. Secret
parametrelerde default kesin olarak reddedilir.

Güvenlik sözleşmesi:

- Save/update/apply araçları yalnız şemayı kaydeder.
- Dashboard Start/Run/Restart anında alanları açar. Secret input maskelidir.
- Değerler yalnız child process'in geçici stdin veya environment akışına
  verilir; Command, Run, History, SQLite ve loglara yazılmaz.
- Değerler restart için saklanmaz; her restart yeniden giriş ister.
- Stack başlatılırken seçilen member ve otomatik eklenen bağımlılıkların gerekli
  alanları tek formda toplanır.
- MCP ile şema oluşturmak güvenlidir. Gerçek secret'ı bir MCP start çağrısında
  göndermek teknik olarak desteklenir, fakat bu değer AI istemcisinin
  tool-call/conversation belleğinden geçer. Bu nedenle secret girişi için
  dashboard tercih edilmelidir; agent secret istememeli, tahmin etmemeli,
  tekrar etmemeli veya loglamamalıdır.

Non-secret bir MCP start örneği:

    {
      "id": "saved-command-id",
      "parameters": {
        "region": "eu"
      }
    }

Stack payload'ında ilk anahtar command ID'dir:

    {
      "id": "saved-stack-id",
      "parameters": {
        "database-command-id": { "profile": "local" },
        "api-command-id": { "region": "eu" }
      }
    }

### 7.5. Gözlem ve sonuç

1. `inspect_run` ile PID, process tree, readiness ve exit state'i oku.
2. `list_ports` ile managed Run portlarını ve geçiş kanıtıyla doğrulanmış external portları kontrol et. `attribution`, `status` ve `confidence` alanlarını raporla; pre-existing portları launcher'a aitmiş gibi sunma.
3. `get_logs` ile `combined`, `stdout` veya `stderr` loglarını oku.
4. Task tamamlandığında exit code'u raporla.
5. Service için açık portları ve `already_running` durumunu raporla.

## 8. MCP araçları

AgentShell şu anda 35 MCP tool sunar.

### Runtime ve Run araçları

| Tool | Amaç |
| --- | --- |
| `get_runtime` | Runtime kimliği, durum, database ve bağlı MCP client'ları |
| `list_ports` | Managed Run portları ve kapalı→dinliyor geçişiyle doğrulanmış external expected portlar |
| `run` | Yeni service veya task başlatmak |
| `list_runs` | Run durumlarını filtreleyerek listelemek |
| `inspect_run` | Process, port, süre, kaynak ve exit detayları |
| `get_logs` | combined/stdout/stderr loglarını okumak |
| `stop_run` | Bir Run'ın process group'unu durdurmak |
| `restart_run` | Aynı immutable spec ile replacement Run başlatmak |
| `shutdown_runtime` | Tüm yönetilen süreçleri ve Runtime'ı kontrollü durdurmak |

### Workspace ve katalog araçları

| Tool | Amaç |
| --- | --- |
| `get_workspace_context` | Explicit olarak yapılandırılmış workspace root'u okumak |
| `inspect_project` | Projeyi bounded ve read-only biçimde incelemek |
| `list_projects` | Kayıtlı projeleri listelemek |
| `save_project` | Project kaydetmek; komut çalıştırmaz |
| `update_project` | Project adı/root path güncellemek |
| `delete_project` | Project kaydını silmek |
| `list_collections` | Collection'ları, gerekirse Project bazında listelemek |
| `save_collection` | Collection oluşturmak; komut çalıştırmaz |
| `update_collection` | Collection bilgilerini güncellemek |
| `delete_collection` | Collection silmek |
| `promote_run` | History Run'ını tekrar kullanılabilir launcher'a dönüştürmek |
| `apply_catalog` | Project + Collection + Command + Stack kataloğunu atomik uygulamak |

### Launcher araçları

| Tool | Amaç |
| --- | --- |
| `list_commands` | Kayıtlı service/task launcher'larını ve runtime durumlarını listelemek |
| `save_command` | Launcher kaydetmek; `project_id` ve `collection_id` kabul eder, çalıştırmaz |
| `update_command` | Launcher alanları ile Project/Collection atamasını güncellemek; çalıştırmaz |
| `delete_command` | Launcher kaydını silmek |
| `start_command` | Kayıtlı launcher'ı başlatmak |
| `stop_command` | Managed launcher'ın aktif Run'ını veya external launcher'ın kendi stop action'ını çalıştırmak |
| `restart_command` | Managed Run'ı yeniden başlatmak ya da external lifecycle restart action'ını çalıştırmak |

### Stack araçları

| Tool | Amaç |
| --- | --- |
| `list_stacks` | Stack ve member durumlarını listelemek |
| `save_stack` | Project/Collection sahibiyle Stack tanımı ve dependency orchestration kaydetmek; member'ları başlatmaz |
| `update_stack` | Stack sahibi, Collection, adı, strateji, üyeler veya dependency/readiness ayarlarını güncellemek |
| `delete_stack` | Stack kaydını silmek |
| `start_stack` | Tüm çalışmayan member'ları veya verilen alt kümeyi transitif bağımlılıklarıyla başlatmak |
| `stop_stack` | Aktif member Run'larını durdurmak |
| `restart_stack` | Çalışanları restart edip eksikleri başlatmak |

### Collection ataması hakkında mevcut sözleşme

Collection'a bağlı tam proje kataloğu oluştururken `apply_catalog` içindeki `collection_key` kullanılmalıdır. Tekil kayıt akışında `collection_id` alanı `save_command`, `update_command`, `save_stack` ve `update_stack` tarafından desteklenir.

History'deki bir Run kaydedilirken `promote_run.collection_id` kullanılabilir.

`save_command` ve `save_stack` doğrudan `collection_id` kabul eder. Project, Collection, çok sayıda launcher ve stack birlikte oluşturulacaksa atomiklik ve idempotency için yine de `apply_catalog` tercih edilmelidir.

### Stack dependency orchestration

Basit bir stack için sıralı `command_ids` hâlâ desteklenir. Gerçek servis bağımlılıklarında `members` kullanılır:

```json
{
  "name": "Local application",
  "start_strategy": "parallel",
  "failure_policy": "stop",
  "members": [
    { "command_id": "database-id", "position": 0, "wait_for": "ready", "wait_timeout_ms": 60000 },
    { "command_id": "api-id", "position": 1, "depends_on": ["database-id"], "wait_for": "ready", "wait_timeout_ms": 60000 },
    { "command_id": "ui-id", "position": 2, "depends_on": ["api-id"], "wait_for": "spawn", "wait_timeout_ms": 30000 }
  ]
}
```

- `depends_on`, aynı stack içindeki command ID'lerini referanslar; self-reference, bilinmeyen ID, duplicate dependency ve cycle reddedilir.
- `wait_for: spawn`, process oluşturulduğunda koşulu tamamlar.
- `wait_for: ready`, managed Run'ın expected portlarını; external lifecycle için doğrulanmış expected-port geçişlerini bekler. External launcher'da bu mod için `expected_ports` zorunludur.
- `wait_for: exit`, command'ın exit code 0 ile tamamlanmasını bekler; migration, build veya setup task'ları için uygundur.
- `parallel`, aynı anda bağımlılığı açılmış member'ları bir wave olarak başlatır. `sequential`, stable `position` sırasıyla tek tek ilerler.
- `failure_policy: stop`, ilk start/wait hatasında yeni member planlamayı bırakır. `continue`, yalnız bağımsız dalları sürdürür; başarısız üyeye bağlı dallar başlatılmaz.
- Stop işlemi dependency sırasının tersidir. Örneğin DB → API → UI, UI → API → DB olarak durdurulur.
- Dashboard'daki Stack detayında **Orchestration** düzenleyicisi aynı alanları yönetir. “Start selected” kullanıldığında gerekli bağımlılıklar otomatik eklenir.

## 9. Önerilen prompt örnekleri

### 9.1. Projeyi incele, hiçbir şey çalıştırma

```text
AgentShell MCP kullan.
Önce get_runtime ve get_workspace_context çağır.
Explicit workspace root'u inspect_project ile salt okunur incele.
Bulduğun service ve task adaylarını evidence, confidence ve warning bilgileriyle listele.
Hiçbir komutu çalıştırma ve katalogda değişiklik yapma.
```

### 9.2. Project, Collection ve launchers oluştur

```text
Bu workspace'i AgentShell Project olarak düzenle.
Internal Services ve Build & Test collection'larını oluştur.
Uzun yaşayan komutları service, build/test/lint komutlarını task yap.
Önce apply_catalog dry-run çalıştır ve sonucu özetle.
Uygulama aşamasında hiçbir launcher'ı başlatma.
Aynı kayıt varsa duplicate oluşturma; reused sonucunu koru.
```

### 9.3. Internal servis stack'i oluştur

```text
AgentShell kataloğundaki internal service launcher'larını bul.
Internal Microservices isimli, parallel start ve continue failure policy kullanan bir stack tasarla.
Önce dry-run göster. Kaydettikten sonra başlatma.
```

DB, API ve UI bağımlılıkları varsa agent'a şu kadar açık tarif verilebilir:

```text
Local Application stack'ini AgentShell'de dependency orchestration ile kaydet.
Önce Database başlasın ve expected portları ready olsun.
Ardından Backend API başlasın ve ready olsun; son olarak Frontend UI başlasın.
DB -> API -> UI bağımlılıklarını members.depends_on ile tanımla, her readiness için 60 saniye timeout kullan.
Önce apply_catalog dry-run göster ve hiçbir şeyi başlatma.
```

### 9.4. Stack'i başlat ve doğrula

```text
AgentShell üzerinden Internal Microservices stack'ini bul.
Önce member durumlarını kontrol et; çalışanları duplicate başlatma.
Eksik member'ları başlat.
Port readiness, Run ID ve son combined logları raporla.
```

### 9.5. Build ve test çalıştır

```text
AgentShell'de bu projeye ait build ve test task launcher'larını bul.
Önce build'i, başarılı olursa test'i çalıştır.
Her task için exit code, duration ve hata varsa stderr özetini ver.
```

### 9.6. History Run'ını kaydet

```text
Son başarılı test Run'ını AgentShell History'den bul.
Backend Tests adıyla task launcher'a promote et.
Bu projenin Build & Test collection'ına koy ve favorile.
Observed portları otomatik expected port olarak kaydetme.
Tekrar çağrılırsa existing launcher'ı reuse et.
```

### 9.7. Log incele

```text
AgentShell'de çalışan Backend API Run'ını bul.
Son 300 combined log satırını oku.
Hata sinyallerini, exit/readiness durumunu ve açık portları özetle.
Servisi restart etme veya durdurma.
```

## 10. Port ve readiness modeli

Expected port tanımı iki ayrı kavram taşır:

```json
{
  "port": 8080,
  "name": "HTTP API",
  "protocol": "tcp",
  "service": "http"
}
```

- `protocol`: transport katmanı; `tcp` veya `udp`.
- `service`: uygulama protokolü; örneğin `http`, `https`, `postgres` veya `metrics`.

Bir Run sırasında görülen port, launcher'ın her çalıştırmada garanti ettiği sabit port olmayabilir. Bu nedenle observed portlar yalnız öneridir ve promotion sırasında açıkça seçilmeden expected port yapılmamalıdır.

## 11. Güvenlik ve davranış sınırları

- `inspect_project` dosyaları okur, candidate üretir ve hiçbir dosyayı çalıştırmaz.
- İnceleme depth, dosya boyutu, entry ve candidate limitleriyle bounded yapılır.
- `save_project`, `save_collection`, `save_command`, `save_stack` ve `apply_catalog` komut başlatmaz.
- Başlatma her zaman `run`, `start_command` veya `start_stack` ile ayrı yapılır.
- Stop, delete ve Runtime shutdown işlemleri destructive olarak işaretlidir.
- `shutdown_runtime` için `confirm: true` gerekir ve MCP bridge'i de koparır.
- Service launcher'larında varsayılan duplicate koruması için `concurrency_policy: forbid` tercih edilmelidir.
- Native shell hâlâ AI istemcisinde mevcut olabilir. Kesin enforcement isteniyorsa istemcinin native terminal yetkisi ayrıca sınırlandırılmalıdır.
- MCP tool sonucu kullanıcı niyetini genişletmez. Agent yalnız istenen servisleri veya task'ları çalıştırmalıdır.

## 12. Sorun giderme

### Dashboard `No MCP clients` gösteriyor

Kontrol sırası:

1. Runtime çalışıyor mu?
2. Claude `/mcp` veya Cursor Tools & MCP içinde `agentshell` etkin mi?
3. MCP istemcisi server'ı initialize etmiş mi?
4. İstemci yapılandırma sonrası yeniden başlatılmış mı?

Yalnız `agentshell mcp` process'inin kısa süre görünmesi bağlantı kanıtı değildir. Dashboard ancak gerçek initialization sonrası lease gösterir.

### MCP bridge hemen kapanıyor

Önce Runtime'ı başlatın:

```bash
cd /Users/sezgin.kahraman/AgentShell
./start.sh
```

Sonra bridge'i elle kontrol edin:

```bash
/Users/sezgin.kahraman/AgentShell/bin/agentshell mcp \
  -workspace-root /Users/sezgin.kahraman/AgentShell \
  -client-name Diagnostic
```

Bu komut normalde stdio üzerinde MCP mesajı bekler. Runtime bulunamıyorsa açık bir discovery/connection hatası verir.

### Runtime farklı portta çalışıyor

Client config args içine ekleyin:

```text
-runtime-url
http://127.0.0.1:PORT
```

Alternatif olarak bridge ortamında `AGENTSHELL_URL` kullanılabilir.

### Runtime farklı data directory kullanıyor

Server ve bridge aynı data directory'yi kullanmalıdır:

```text
-data-dir
/absolute/path/to/state
```

Alternatif environment variable:

```text
AGENTSHELL_DATA_DIR=/absolute/path/to/state
```

### `get_workspace_context` configured false dönüyor

MCP args içinde `-workspace-root` eksiktir. Runtime çalışma klasöründen otomatik tahmin yapılmaz.

Doğru örnek:

```text
mcp -workspace-root /absolute/path/to/workspace
```

### Cursor server'ı görüyor fakat tool'ları kullanmıyor

- Cursor'u reload edin.
- `Settings → Tools & MCP` altında server'ı enable edin.
- Chat'i `Agent` moduna alın.
- Tool approval beklenip beklenmediğini kontrol edin.
- Project `.cursor/mcp.json` dosyasındaki binary ve workspace yollarının gerçekten mevcut olduğunu doğrulayın.

### Claude server'ı görüyor fakat disconnected

```bash
claude mcp get agentshell
claude mcp list
```

Project-scoped `.mcp.json` kullanılıyorsa güven onayını kontrol edin. Claude Code içinde `/mcp` ekranını açın.

### UI değişiklikleri görünmüyor

Web asset'leri binary içine gömülüdür. Yeniden build edilen UI için Runtime'ı kontrollü yeniden başlatın:

```bash
./bin/agentshell shutdown
./start.sh
```

Bu işlem mevcut AgentShell-managed Run'ları da durdurur.

### Bir service iki kez başlıyor

- Agent önce `list_commands` ve `list_runs` çağırmalıdır.
- Service launcher için `concurrency_policy: forbid` kullanılmalıdır.
- `already_running` sonucu hata gibi gizlenmemeli, kullanıcıya bildirilmelidir.

## 13. Bağlantı kabul testi

Her iki istemci bağlandıktan sonra aşağıdaki test uygulanabilir.

### Salt okunur test

Claude Code ve Cursor Agent'a ayrı ayrı:

```text
AgentShell MCP ile get_runtime, get_workspace_context, list_projects,
list_commands ve list_runs çağır. Hiçbir şeyi değiştirme veya çalıştırma.
Sonuçları özetle.
```

Beklenti:

- İki istemci de aynı Runtime `instance_id` değerini görür.
- İki istemci de aynı Project/Command listelerini görür.
- Dashboard iki gerçek MCP client gösterir.

### Kontrollü task testi

```text
AgentShell üzerinden bu workspace'te
printf 'AgentShell MCP OK\n'
komutunu task olarak çalıştır, exit'i bekle ve combined logu göster.
```

Beklenti:

- Yeni bir Run oluşur.
- `kind` değeri `task` olur.
- Exit code `0` olur.
- History içinde görünür.
- Combined log içinde `AgentShell MCP OK` bulunur.

### Cross-client testi

1. Claude Code ile bir launcher kaydedin; başlatmayın.
2. Cursor Agent ile `list_commands` çağırıp aynı launcher'ı bulun.
3. Cursor ile launcher'ı başlatın.
4. Claude ile `get_logs` çağırıp aynı Run loglarını okuyun.
5. Dashboard'dan Run, port ve log durumunu doğrulayın.

## 14. Hızlı kontrol listesi

- [ ] `./start.sh` ile Runtime çalışıyor.
- [ ] Dashboard `http://127.0.0.1:4242` açılıyor.
- [ ] Claude Code `claude mcp list` içinde `agentshell` görüyor.
- [ ] Cursor Tools & MCP içinde `agentshell` enabled.
- [ ] Her config gerçek absolute binary yolunu kullanıyor.
- [ ] Her config explicit `-workspace-root` içeriyor.
- [ ] Dashboard gerçek istemci isimlerini gösteriyor.
- [ ] `get_workspace_context` doğru root'u döndürüyor.
- [ ] Read-only bağlantı testi geçiyor.
- [ ] Kontrollü task testi History ve Logs içinde görünüyor.

## 15. Resmî istemci dokümantasyonları

- Claude Code MCP: <https://docs.anthropic.com/en/docs/claude-code/mcp>
- Cursor MCP: <https://docs.cursor.com/context/model-context-protocol>

AgentShell'in genel build/runtime açıklaması için repo kökündeki `README.md` dosyasına bakın.
