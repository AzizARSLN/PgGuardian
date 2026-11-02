"""Wording of findings and tasks, per language. Analyses only store codes and values."""

from __future__ import annotations

from typing import Any

Text = tuple[str, str]  # (tr, en)
ROLES = ("backend", "ui", "db")

# code: title, problem, then tasks per role.
FINDINGS: dict[str, dict[str, Any]] = {
    "SEQUENCE_EXHAUSTED": {
        "title": ("Sequence maksimum değerine ulaştı", "A sequence reached its maximum value"),
        "problem": (
            "{count} kez nextval hata verdi. O tabloya yeni kayıt girilemiyor; işlem kullanıcıya hata olarak dönüyor. En yoğun saat: {peak}.",
            "nextval failed {count} times. That table cannot take new rows and users get an error. Busiest hour: {peak}.",
        ),
        "db": [
            ("Hangi sequence olduğunu sunucu logundan bulun: last_value ve max_value değerlerine pg_sequences ile bakın.", "Find the sequence in the server log and check last_value and max_value in pg_sequences."),
            ("Kolon integer ise bigint'e geçişi planlayın; bu arada ALTER SEQUENCE ... MAXVALUE ile geçici olarak açın.", "If the column is integer, plan a move to bigint; meanwhile raise it with ALTER SEQUENCE ... MAXVALUE."),
            ("Tüm sequence'ların doluluk oranını izlemeye alın (Teşhis ekranında var).", "Monitor how full every sequence is (available on the Diagnostics screen)."),
        ],
        "backend": [
            ("Bu tabloya yazan kodda nextval hatasının nasıl ele alındığını kontrol edin; hata sessizce yutulmamalı.", "Check how code writing to this table handles the nextval error; it must not be swallowed."),
            ("Id alanı uygulamada int ise long tipine çevrilmesini planlayın.", "If the id is an int in the application, plan the move to long."),
        ],
    },
    "RESOURCE_EXHAUSTED": {
        "title": ("Bellek veya disk tükendi", "Memory or disk ran out"),
        "problem": ("{count} kez kaynak yetersizliği hatası oluştu. En yoğun saat: {peak}.", "Resource errors occurred {count} times. Busiest hour: {peak}."),
        "db": [("Disk ve bellek kullanımını kontrol edin; work_mem ve bağlantı sayısı çarpımını gözden geçirin.", "Check disk and memory; review work_mem multiplied by the connection count.")],
    },
    "TOO_MANY_CONNECTIONS": {
        "title": ("Bağlantı limiti doldu", "The connection limit was reached"),
        "problem": ("{count} bağlantı reddedildi. En yoğun saat: {peak}.", "{count} connections were refused. Busiest hour: {peak}."),
        "db": [("max_connections'ı yükseltmek yerine PgBouncer gibi bir havuz değerlendirin.", "Consider a pooler such as PgBouncer rather than raising max_connections.")],
        "backend": [("Uygulama havuz boyutlarını ve kapatılmayan bağlantıları kontrol edin.", "Check application pool sizes and connections left open.")],
    },
    "DEADLOCK": {
        "title": ("Deadlock oluşuyor", "Deadlocks are occurring"),
        "problem": ("{count} deadlock yakalandı ve işlemlerden biri iptal edildi. En yoğun saat: {peak}.", "{count} deadlocks were detected, each cancelling a transaction. Busiest hour: {peak}."),
        "backend": [
            ("Sunucu logundaki DETAIL satırlarından çakışan iki işlemi bulun; aynı tablolara her yerde aynı sırayla yazın.", "Find both transactions in the server log's DETAIL lines; write to the same tables in the same order everywhere."),
            ("Deadlock hatası (40P01) alındığında işlemi yeniden deneyen bir mekanizma ekleyin.", "Retry the transaction when it fails with deadlock error 40P01."),
        ],
        "db": [("log_lock_waits açık kalsın; deadlock'ların tablo ve saat dağılımını takip edin.", "Keep log_lock_waits on and track deadlocks by table and hour.")],
    },
    "LOCK_WAITS": {
        "title": ("Satır kilitleri için uzun beklemeler", "Long waits on row locks"),
        "problem": ("{count} kez bir işlem deadlock_timeout süresinden uzun kilit bekledi. En yoğun saat: {peak}.", "Sessions waited longer than deadlock_timeout {count} times. Busiest hour: {peak}."),
        "backend": [("Transaction'ları kısa tutun: dış servis çağrısı ve ekran beklemesi transaction içinde olmasın.", "Keep transactions short: no external calls or user waits inside them.")],
        "db": [("Canlı Sorgular ekranında 'bekliyor' ve idle in transaction satırlarından kilidi tutan oturumu bulun.", "Use the waiting and idle in transaction rows on Live Queries to find who holds the lock.")],
    },
    "LOCK_CONTENTION": {
        "title": ("Aynı tablolarda yoğun kilit rekabeti", "Heavy lock contention on the same tables"),
        "problem": ("Toplam {total} kilit beklemesi ({count} kayıt). En çok bekleyen tablolar: {tables}. Bekleyen uygulamalar: {apps}.", "{total} of lock waits in {count} entries. Most affected tables: {tables}. Waiting applications: {apps}."),
        "backend": [
            ("Bu tablolardaki UPDATE ve SELECT ... FOR UPDATE işlemlerinin bulunduğu transaction'ları inceleyin; kilit yalnızca gerektiği kadar tutulsun.", "Review the transactions holding UPDATE and SELECT ... FOR UPDATE on these tables; hold locks only as long as needed."),
            ("Stok gibi sık güncellenen sayaç satırları için güncellemeyi transaction'ın sonuna alın veya kuyruklayın.", "For frequently updated counter rows such as stock levels, update at the end of the transaction or queue the change."),
        ],
        "ui": [("Aynı kaydı iki kez gönderen çift tıklamayı engelleyin; kaydet düğmesi istek sürerken pasif olsun.", "Prevent double submits: disable the save button while the request runs.")],
        "db": [("lock_timeout ve idle_in_transaction_session_timeout değerlerini gözden geçirin.", "Review lock_timeout and idle_in_transaction_session_timeout.")],
    },
    "LOCK_TIMEOUT": {
        "title": ("Lock timeout nedeniyle iptal edilen sorgular", "Statements cancelled by lock timeout"),
        "problem": ("{count} sorgu kilit alamadığı için iptal edildi; kullanıcı bunu hata olarak görür. En yoğun saat: {peak}.", "{count} statements were cancelled waiting for a lock, which users see as errors. Busiest hour: {peak}."),
        "backend": [("Bu hatayı (55P03) yakalayıp kullanıcıya anlamlı mesaj verin veya kısa bir beklemeyle yeniden deneyin.", "Catch this error (55P03) and show a clear message or retry after a short wait.")],
        "ui": [("Kilit hatasında genel hata yerine 'kayıt başka kullanıcı tarafından işleniyor' mesajı gösterin.", "On lock errors show 'this record is being processed by another user' rather than a generic error.")],
    },
    "TX_ABORTED": {
        "title": ("Hatadan sonra transaction'a devam ediliyor", "Transactions continue after an error"),
        "problem": ("{count} kez 'current transaction is aborted' alındı: bir hata sonrası aynı transaction'da sorgu göndermeye devam ediliyor. En yoğun saat: {peak}.", "'current transaction is aborted' occurred {count} times: code keeps sending statements after an error. Busiest hour: {peak}."),
        "backend": [
            ("Hata yakalayıp devam eden catch bloklarını bulun; hata sonrası rollback yapılmalı veya savepoint kullanılmalı.", "Find catch blocks that carry on after an error; roll back or use a savepoint."),
            ("Bu mesajdan hemen önceki asıl hataya bakın; genellikle duplicate key veya kilit hatasıdır.", "Look at the real error right before this message; it is usually a duplicate key or a lock error."),
        ],
    },
    "DUPLICATE_KEY": {
        "title": ("Tekrarlı kayıt hataları", "Duplicate key errors"),
        "problem": ("{count} kez unique kısıt ihlali oluştu. En yoğun saat: {peak}.", "Unique constraints were violated {count} times. Busiest hour: {peak}."),
        "backend": [("Önce kontrol edip sonra ekleyen akışları INSERT ... ON CONFLICT ile değiştirin; id üretiminin sequence ile uyumunu doğrulayın.", "Replace check-then-insert flows with INSERT ... ON CONFLICT; verify id generation matches the sequence.")],
        "ui": [("Formların iki kez gönderilmesini engelleyin.", "Prevent forms from being submitted twice.")],
        "db": [("Sequence değerleri tablo verisinin gerisinde kalmış mı kontrol edin (özellikle veri aktarımlarından sonra).", "Check that sequences are not behind the table data, especially after imports.")],
    },
    "USER_CANCEL": {
        "title": ("Kullanıcı veya uygulama sorgu iptal ediyor", "Users or the application cancel queries"),
        "problem": ("{count} sorgu kullanıcı isteğiyle iptal edildi. Genelde yavaş ekranda bekleyemeyen kullanıcıyı veya istemci zaman aşımını gösterir. En yoğun saat: {peak}.", "{count} statements were cancelled on request, usually users giving up on a slow screen or a client timeout. Busiest hour: {peak}."),
        "backend": [("JDBC/ORM sorgu zaman aşımı ayarlarını kontrol edin; iptal olan sorgular yukarıdaki yavaş sorgularla eşleşiyor mu bakın.", "Check JDBC/ORM query timeouts and whether cancelled statements match the slow queries above.")],
        "ui": [("Uzun süren ekranlarda ilerleme gösterin; yeni arama başlatınca öncekini iptal edin ve arka arkaya istek atmayın.", "Show progress on slow screens; cancel the previous search on a new one and avoid rapid repeat requests.")],
    },
    "STATEMENT_TIMEOUT": {
        "title": ("Statement timeout", "Statement timeouts"),
        "problem": ("{count} sorgu statement_timeout sınırına takıldı. En yoğun saat: {peak}.", "{count} statements hit statement_timeout. Busiest hour: {peak}."),
        "backend": [("Bu sorguları yukarıdaki yavaş sorgu bulgularıyla birlikte ele alın.", "Handle these together with the slow query findings above.")],
    },
    "ANALYZE_NON_TABLES": {
        "title": ("ANALYZE betiği tablo olmayan nesneleri deniyor", "An ANALYZE script targets non-tables"),
        "problem": ("{count} uyarı, neredeyse tamamı {peak} civarında. Gece çalışan bir bakım betiği view veya foreign table üzerinde ANALYZE deniyor; log gürültüsü yaratıyor.", "{count} warnings, nearly all around {peak}. A nightly maintenance script runs ANALYZE on views or foreign tables and floods the log."),
        "db": [("Bakım betiğini yalnızca relkind r, p, m nesnelerini seçecek şekilde düzeltin.", "Limit the maintenance script to objects with relkind r, p or m.")],
    },
    "SQL_ERRORS": {
        "title": ("Uygulamadan hatalı SQL geliyor", "The application sends invalid SQL"),
        "problem": ("{count} kez olmayan nesne veya sözdizimi hatası alındı. Sürüm farkı, eksik migration veya elle yazılan sorgu olabilir. En yoğun saat: {peak}.", "{count} missing object or syntax errors. Possibly a version mismatch, a missing migration or handwritten SQL. Busiest hour: {peak}."),
        "backend": [("Aşağıdaki mesajlardaki nesneleri kodda arayın; search_path ve migration durumunu doğrulayın.", "Search the code for the objects below; verify search_path and migrations.")],
        "db": [("Sürümler arası şema farkı olup olmadığını kontrol edin.", "Check for schema differences between versions.")],
    },
    "DATA_ERRORS": {
        "title": ("Veri doğrulama hataları veritabanına kadar geliyor", "Validation errors reach the database"),
        "problem": ("{count} kez NOT NULL, foreign key veya uzunluk kısıtı ihlal edildi. En yoğun saat: {peak}.", "NOT NULL, foreign key or length constraints were violated {count} times. Busiest hour: {peak}."),
        "backend": [("Bu kuralları kayıttan önce serviste doğrulayın, hatayı anlaşılır mesaja çevirin.", "Validate these rules in the service before saving and return a clear message.")],
        "ui": [("Zorunlu alan ve uzunluk kurallarını formda gösterin.", "Show required and length rules on the form.")],
    },
    "IDLE_TX_TIMEOUT": {
        "title": ("Açık unutulan transaction'lar", "Transactions left open"),
        "problem": ("{count} bağlantı idle-in-transaction zaman aşımıyla kapatıldı: transaction açılıp commit edilmeden beklenmiş. Bu durum kilitleri de tutar. En yoğun saat: {peak}.", "{count} connections were closed by the idle-in-transaction timeout: a transaction was opened and left waiting, also holding locks. Busiest hour: {peak}."),
        "backend": [("Transaction sınırlarını gözden geçirin; ekran açıkken veya dış çağrı sırasında transaction açık kalmasın.", "Review transaction boundaries; none should stay open during a user wait or an external call.")],
    },
    "IDLE_SESSION_TIMEOUT": {
        "title": ("Boşta bağlantılar sunucu tarafından kapatılıyor", "Idle connections are closed by the server"),
        "problem": ("{count} bağlantı idle-session zaman aşımıyla kapatıldı. En yoğun saat: {peak}.", "{count} connections were closed by the idle-session timeout. Busiest hour: {peak}."),
        "backend": [("Havuzun bağlantı ömrünü (maxLifetime) sunucu zaman aşımından kısa ayarlayın ve validation sorgusu kullanın.", "Set the pool's maxLifetime below the server timeout and use a validation query.")],
    },
    "CLIENT_DISCONNECTS": {
        "title": ("İstemci bağlantıları kopuyor", "Client connections are dropping"),
        "problem": ("{count} kez bağlantı istemci tarafında koptu. Uygulama yeniden başlaması, ağ veya zaman aşımı olabilir. En yoğun saat: {peak}.", "Connections dropped on the client side {count} times: application restarts, the network or timeouts. Busiest hour: {peak}."),
        "db": [("Saatleri uygulama yeniden başlatmaları ve ağ olaylarıyla karşılaştırın.", "Compare the times with application restarts and network events.")],
    },
    "AUTH_PROBLEMS": {
        "title": ("Kimlik doğrulama sorunları", "Authentication problems"),
        "problem": ("{count} kimlik doğrulama hatası veya zaman aşımı. En yoğun saat: {peak}.", "{count} authentication failures or timeouts. Busiest hour: {peak}."),
        "db": [("Kaynak adresleri sunucu logundan kontrol edin; LDAP veya authentication_timeout yavaşlığına bakın.", "Check source addresses in the server log; look for slow LDAP or authentication_timeout.")],
    },
    "ADMIN_TERMINATIONS": {
        "title": ("Bağlantılar yönetici komutuyla sonlandırılıyor", "Connections are terminated by administrator command"),
        "problem": ("{count} oturum veya background worker pg_terminate_backend ya da restart ile sonlandırıldı. En yoğun saat: {peak}.", "{count} sessions or background workers ended through pg_terminate_backend or a restart. Busiest hour: {peak}."),
        "db": [("Sonlandırma yapan kişi veya betiği belirleyin; otomatik kill betikleri varsa nedenini gözden geçirin. Paralel worker'lar için ana sorguyu takip edin.", "Find who or what terminates them; review any automatic kill scripts. For parallel workers follow the parent query.")],
    },
    "OTHER_ERRORS": {
        "title": ("Diğer hatalar", "Other errors"),
        "problem": ("{count} kez başka hata alındı; aşağıdaki mesajları inceleyin. En yoğun saat: {peak}.", "{count} other errors; review the messages below. Busiest hour: {peak}."),
        "backend": [("Aşağıdaki hata mesajlarının kaynağını kod veya veritabanı fonksiyonlarında bulun.", "Find the source of these messages in the code or database functions.")],
    },
    "TEST_APP_ON_PRODUCTION": {
        "title": ("Test uygulaması bu sunucuda en büyük yüklerden biri", "A test application is among the largest loads here"),
        "problem": ("{apps} toplam sürenin %{share}'ini ({total}, {count} sorgu) kullanıyor. Adından test ortamı olduğu anlaşılıyor; yanlış yapılandırılmışsa üretim sunucusunu yoruyordur.", "{apps} uses {share}% of total time ({total}, {count} queries). Its name suggests a test environment; if misconfigured, it is loading production."),
        "backend": [("Bu uygulamanın gerçekten bu sunucuya bağlanması gerekip gerekmediğini doğrulayın; değilse bağlantı ayarını düzeltin.", "Confirm this application should connect to this server; if not, fix its connection settings.")],
        "db": [("Test kullanıcısını üretimden ayırın; gerekiyorsa pg_hba.conf ile kaynağı kısıtlayın.", "Separate the test user from production; restrict its source in pg_hba.conf if needed.")],
    },
    "BACKUP_LOAD": {
        "title": ("Yedekleme ana sunucuda çok uzun sürüyor", "Backups run very long on the primary"),
        "problem": ("{apps} toplam sürenin %{share}'ini ({total}) kullanıyor. En uzun tek işlem {longest} ({table}). Canlı log ve dosya tabloları bunu büyütüyor.", "{apps} uses {share}% of total time ({total}). The longest single step took {longest} ({table}). Log and file tables make it larger."),
        "db": [
            ("Mantıksal yedeği replikadan alın veya fiziksel yedeğe (pgBackRest) geçin; pg_dump uzun transaction tutarak vacuum'u da engeller.", "Take logical backups from a replica or move to physical backups (pgBackRest); pg_dump's long transaction also holds back vacuum."),
            ("Büyük log tablolarını ayrı arşivleyin ve --exclude-table-data ile dışarıda bırakın; bölümleme (partitioning) değerlendirin.", "Archive large log tables separately, exclude them with --exclude-table-data and consider partitioning."),
            ("Yedek süresinin mesai başına taşmadığını doğrulayın.", "Verify backups finish before working hours."),
        ],
        "backend": [("Fotoğraf ve dosyaları veritabanı dışında tutmayı değerlendirin; log tablolarına saklama süresi koyun.", "Consider storing photos and files outside the database; add retention to log tables.")],
    },
    "UNNAMED_APPLICATION": {
        "title": ("Bağlantıların bir kısmı uygulama adı vermiyor", "Some connections have no application name"),
        "problem": ("Toplam sürenin %{share}'i ({total}) kaynağı bilinmeyen bağlantılardan geliyor; sorunun sahibi bulunamıyor.", "{share}% of total time ({total}) comes from connections with no name, so nobody can be held to it."),
        "backend": [("Tüm servislerde bağlantı adresine ApplicationName parametresi ekleyin.", "Set ApplicationName in the connection settings of every service.")],
    },
    "ADHOC_TOOLS": {
        "title": ("Üretimde elle sorgu çalıştırılıyor", "Manual queries on production"),
        "problem": ("{apps} araçlarından {count} uzun sorgu çalışmış.", "{count} slow statements came from {apps}."),
        "db": [("Bu araçlar için salt okunur kullanıcı ve statement_timeout tanımlayın; mümkünse replikaya yönlendirin.", "Give these tools a read-only user with a statement_timeout; point them at a replica when possible.")],
    },
    "HIGH_CONCURRENT_LOAD": {
        "title": ("Sunucu sürekli yavaş sorgularla meşgul", "The server is constantly busy with slow queries"),
        "problem": ("{hours} saatte {total} sorgu süresi birikmiş: ortalamada her an {average} yavaş sorgu çalışıyor. Yalnızca log eşiğini aşanlar sayıldığı için gerçek yük daha yüksektir.", "{total} of query time in {hours} hours: on average {average} slow queries running at any moment. Only those above the log threshold are counted, so the real load is higher."),
        "backend": [("Önce bu listedeki en yüksek paya sahip sorguları ele alın.", "Start with the highest share queries in this list.")],
        "db": [("CPU, disk ve aktif oturum sayısını yoğun saatlerde izleyin; okuma ağırlıklı raporları replikaya yönlendirmeyi değerlendirin.", "Watch CPU, disk and active sessions at peak; consider sending read-heavy reports to a replica.")],
    },
    "TEMP_FILES": {
        "title": ("Sorgular diske geçici dosya yazıyor", "Queries write temp files to disk"),
        "problem": ("{count} geçici dosya, en büyüğü {max}, ortalama {avg}. Sıralama ve hash işlemleri work_mem'e sığmıyor.", "{count} temp files, largest {max}, average {avg}. Sorts and hashes do not fit in work_mem."),
        "db": [("Global work_mem'i yükseltmeden önce aşağıdaki sorguları düzeltin; gerekiyorsa o kullanıcı veya işlem için artırın.", "Fix the queries below before raising the global work_mem; raise it per user or transaction if needed.")],
    },
    "CHECKPOINT_PRESSURE": {
        "title": ("Checkpoint yükü yüksek", "High checkpoint load"),
        "problem": ("En uzun yazma {write} sn. Zamanlanmış checkpoint: {scheduled}, zorunlu: {forced}. {wal}. {distance}.", "Longest write {write} s. Scheduled checkpoints: {scheduled}, forced: {forced}. {wal}. {distance}."),
        "db": [("checkpoint_timeout, max_wal_size ve checkpoint_completion_target değerlerini yazma yüküne göre gözden geçirin; disk gecikmesini ölçün.", "Review checkpoint_timeout, max_wal_size and checkpoint_completion_target against the write load; measure disk latency.")],
    },
    "DDL_IN_WORKLOAD": {
        "title": ("İş yükünün içinde DDL var", "DDL inside the workload"),
        "problem": ("Yavaş sorguların %{share}'i ({count}) DDL. Geçici tablo veya şema değişikliği olabilir; DDL güçlü kilit alır ve katalog şişmesi yapar.", "{share}% of slow statements ({count}) are DDL. These may be temp tables or schema changes; DDL takes strong locks and bloats the catalog."),
        "backend": [("Çalışma anında tablo oluşturan kodu bulun; CTE veya kalıcı çalışma tablosu değerlendirin.", "Find code creating tables at runtime; consider a CTE or a permanent work table.")],
        "db": [("pg_catalog tablolarının şişmesini takip edin.", "Watch for bloat in pg_catalog tables.")],
    },
    "LOG_BLIND_SPOTS": {
        "title": ("Log ayarları nedeniyle eksik görünürlük", "Log settings leave blind spots"),
        "problem": ("Raporda hiç veri gelmeyen alanlar: {settings}. En kısa sorgu {threshold}, yani log_min_duration_statement bu civarda: daha hızlı ama çok sık çalışan sorgular bu raporda görünmez.", "No data in the report for: {settings}. The fastest statement is {threshold}, so log_min_duration_statement is about that: fast but frequent queries do not appear here."),
        "db": [
            ("Eksik ayarları açın ve bir sonraki raporda oturum ile autovacuum bölümlerini doğrulayın.", "Enable the missing settings and check the session and autovacuum sections in the next report."),
            ("Sık çalışan hızlı sorgular için bu uygulamadaki SQL Analizi ekranını (pg_stat_statements) kullanın.", "Use the SQL Analysis screen (pg_stat_statements) for fast, frequent queries."),
        ],
    },
    "NO_PREPARED_STATEMENTS": {
        "title": ("Prepared statement oranı sıfır görünüyor", "The prepared statement ratio shows zero"),
        "problem": ("Raporda prepared statement görülmüyor. Log eşiği nedeniyle olabilir; gerçekten kullanılmıyorsa her sorgu yeniden planlanıyordur.", "No prepared statements appear in the report. This may be the log threshold; if they really are unused, every query is planned again."),
        "backend": [("JDBC prepareThreshold ve PgBouncer modunu kontrol edin.", "Check JDBC prepareThreshold and the PgBouncer mode.")],
    },
    "QUERY_LOAD": {
        "title": ("Yük yaratan sorgu: {tables}", "Heavy query: {tables}"),
        "problem": ("Toplam sürenin %{share}'i ({total}). {calls} çalışma, ortalama {avg}, en uzun {max}. En yoğun saat: {peak}. Uygulamalar: {apps}.", "{share}% of total time ({total}). {calls} runs, average {avg}, longest {max}. Busiest hour: {peak}. Applications: {apps}."),
    },
}

# Things found in one statement, each adding work for a role.
TRAITS: dict[str, dict[str, Any]] = {
    "WIDE_SELECT": {
        "label": ("Çok fazla kolon", "Too many columns"),
        "backend": [("Yalnızca gereken kolonları okuyan projeksiyon/DTO sorgusu yazın; tüm entity'yi getirmeyin.", "Write a projection/DTO query reading only the needed columns rather than the whole entity.")],
        "ui": [("Listede yalnızca görünen alanları isteyin, detayı satır açılınca ayrı yükleyin.", "Request only the visible fields in lists and load details when a row opens.")],
    },
    "NO_LIMIT": {
        "label": ("LIMIT yok", "No LIMIT"),
        "backend": [("Sayfalama ekleyin; sonuç sınırsız dönmesin.", "Add paging so results are never unbounded.")],
        "ui": [("Listeyi sayfalı gösterin ve geniş tarih aralığına izin vermeyin.", "Show the list in pages and do not allow unbounded date ranges.")],
    },
    "OFFSET": {
        "label": ("OFFSET ile sayfalama", "OFFSET paging"),
        "backend": [("Derin sayfalarda keyset sayfalamaya geçin.", "Move to keyset paging for deep pages.")],
        "ui": [("Sayfa numarası yerine 'daha fazla yükle' veya sonsuz kaydırma kullanın.", "Use 'load more' or infinite scroll rather than page numbers.")],
    },
    "COUNT_ONLY": {
        "label": ("Sürekli toplam sayısı alınıyor", "Counting totals repeatedly"),
        "backend": [("Toplam sayıyı önbelleğe alın veya yalnızca istendiğinde hesaplayın; rozet için count yerine EXISTS kullanın.", "Cache the total or compute it only on request; use EXISTS instead of count for badges.")],
        "ui": [("Her açılışta toplam sayı istemeyin; rozetleri seyrek yenileyin veya sayfa açıkken bekletin.", "Do not ask for totals on every open; refresh badges rarely.")],
    },
    "MANY_JOINS": {
        "label": ("Çok tablolu birleştirme", "Many joins"),
        "backend": [("Kullanılmayan JOIN'leri kaldırın; ORM eager ilişkilerini gözden geçirin, gerekirse iki aşamalı okuyun.", "Remove unused joins; review ORM eager relations and read in two steps if needed.")],
    },
    "SUBQUERIES": {
        "label": ("Alt sorgular", "Subqueries"),
        "backend": [("Satır başına çalışan alt sorguları JOIN veya önceden hesaplanmış değerle değiştirin.", "Replace per-row subqueries with joins or precomputed values.")],
    },
    "DISTINCT": {
        "label": ("DISTINCT", "DISTINCT"),
        "backend": [("DISTINCT'e neden ihtiyaç duyulduğuna bakın; çoğu zaman hatalı JOIN'in çoğalttığı satırları gizler.", "Ask why DISTINCT is needed; it often hides rows multiplied by a wrong join.")],
    },
    "FUNC_ON_COLUMN": {
        "label": ("Kolon üzerinde fonksiyon", "Function on a column"),
        "backend": [("WHERE içinde kolonu fonksiyona sokmayın; tarih için aralık kullanın, normalize edilmiş değer saklayın.", "Do not wrap columns in functions in WHERE; use date ranges and store normalized values.")],
        "db": [("Değiştirilemiyorsa aynı ifadeyle expression index değerlendirin.", "If it cannot change, consider an expression index on the same expression.")],
    },
    "OR_CONDITION": {
        "label": ("OR koşulları", "OR conditions"),
        "backend": [("Dinamik filtre oluşturan kodda OR'ları azaltın; seçilmeyen filtreyi sorguya eklemeyin.", "Reduce ORs in dynamic filter code; leave unused filters out of the query.")],
    },
    "TEXT_SEARCH": {
        "label": ("Metin araması", "Text search"),
        "backend": [("Baştan joker aramalar için pg_trgm veya tam metin arama kullanın.", "Use pg_trgm or full-text search for leading wildcard searches.")],
        "ui": [("Aramayı en az 3 karakter ve gecikmeli (debounce) başlatın.", "Start searches at 3 characters with a debounce.")],
        "db": [("Gerekirse gin_trgm_ops index'i ekleyin.", "Add a gin_trgm_ops index if needed.")],
    },
    "REPEATED": {
        "label": ("Çok sık çalışıyor", "Runs very often"),
        "backend": [("Çağıran yeri bulun: döngü veya N+1 ise toplu okuyun, değişmeyen veriyi önbelleğe alın.", "Find the caller: read in bulk if it is a loop or N+1 and cache data that does not change.")],
        "ui": [("Otomatik yenileme ve arka arkaya istekleri azaltın; aynı veriyi ekran içinde tekrar istemeyin.", "Reduce auto refresh and rapid requests; do not request the same data twice on a screen.")],
    },
    "TEMP_SPILL": {
        "label": ("Diske taşıyor", "Spills to disk"),
        "backend": [("Sıralanan ve gruplanan satır sayısını filtreyle azaltın.", "Reduce the rows sorted and grouped with filters.")],
        "db": [("Sıralamayı karşılayan index'i ve bu işlem için work_mem'i değerlendirin.", "Consider an index providing the order and work_mem for this operation.")],
    },
    "ROUTINE": {
        "label": ("Veritabanı fonksiyonu", "Database routine"),
        "db": [("Fonksiyon içindeki sorguları auto_explain (log_nested_statements) ile inceleyin.", "Inspect the statements inside the routine with auto_explain (log_nested_statements).")],
        "backend": [("Çağrı sıklığını ve işlenen veri miktarını gözden geçirin.", "Review how often it is called and how much data it handles.")],
    },
    "SCHEDULED_JOB": {
        "label": ("Zamanlanmış iş", "Scheduled job"),
        "db": [("Mesai saatinde çalışan işi yoğun olmayan saate alın.", "Move a job running in working hours to a quiet time.")],
    },
    "ORM_GENERATED": {
        "label": ("ORM ile üretilmiş", "Generated by an ORM"),
        "backend": [("Kaynak: t0, t1 takma adları ORM üretimine işaret ediyor; tablodaki entity'nin sorgusunu ve fetch ayarlarını inceleyin.", "The t0, t1 aliases point to an ORM; review the entity's query and fetch settings.")],
    },
    "UNPARSED": {"label": ("SQL ayrıştırılamadı", "SQL could not be parsed")},
}

INDEX_STATUS: dict[str, Text] = {
    "unverified": ("Seçili profilde doğrulanamadı", "Could not be verified on the selected profile"),
    "missing": ("Seçili profilde bu kolonlarda index yok", "No index on these columns on the selected profile"),
    "partial": ("Kısmi index var, kolon sırasını kontrol edin", "A partial index exists, check the column order"),
    "covered": ("Bu kolonlar için index zaten var; plana bakın", "An index already covers these columns; check the plan"),
}

INDEX_TASK: Text = (
    "Index adayını EXPLAIN ile doğrulayıp yoğun olmayan saatte oluşturun ({status}): {ddl}",
    "Verify the index candidate with EXPLAIN and create it at a quiet time ({status}): {ddl}",
)
PLAN_TASK: Text = (
    "EXPLAIN (ANALYZE, BUFFERS) ile planı alın; index mevcutken neden yavaş olduğunu inceleyin: {table}.",
    "Take the plan with EXPLAIN (ANALYZE, BUFFERS) and find why it is slow despite the index: {table}.",
)


class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return "-"


def _pick(text: Text, lang: str) -> str:
    return text[0] if lang == "tr" else text[1]


def render_finding(finding: dict[str, Any], lang: str, states: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A stored finding with its text and its tasks' current status."""
    entry = FINDINGS.get(finding["code"], {})
    values = _Safe(finding.get("values") or {})
    title = _pick(entry.get("title", (finding["code"], finding["code"])), lang).format_map(values)
    problem = _pick(entry.get("problem", ("", "")), lang).format_map(values)
    tasks: dict[str, list[str]] = {role: [] for role in ROLES}
    for role in ROLES:
        tasks[role].extend(_pick(t, lang) for t in entry.get(role, []))
    trait_labels = []
    for code in finding.get("traits", []):
        trait = TRAITS.get(code, {})
        trait_labels.append({"code": code, "label": _pick(trait.get("label", (code, code)), lang)})
        for role in ROLES:
            tasks[role].extend(_pick(t, lang) for t in trait.get(role, []))
    index_view = []
    for index in finding.get("index", []):
        status = _pick(INDEX_STATUS.get(index["status"], ("", "")), lang)
        index_view.append({**index, "status_text": status})
        if index.get("ddl"):
            tasks["db"].append(_pick(INDEX_TASK, lang).format(status=status, ddl=index["ddl"]))
        else:
            tasks["db"].append(_pick(PLAN_TASK, lang).format(table=index["table"]))
    rendered: dict[str, list[dict[str, Any]]] = {}
    for role, items in tasks.items():
        rendered[role] = []
        for position, text in enumerate(items):
            task_id = f"{finding['id']}:{role}:{position}"
            state = states.get(task_id, {})
            rendered[role].append(
                {
                    "id": task_id,
                    "text": text,
                    "status": state.get("status", "todo"),
                    "updated_by": state.get("updated_by"),
                    "updated_at": state.get("updated_at"),
                }
            )
    return {
        "id": finding["id"],
        "code": finding["code"],
        "severity": finding["severity"],
        "category": finding["category"],
        "title": title,
        "problem": problem,
        "traits": trait_labels,
        "sql": finding.get("sql"),
        "messages": finding.get("messages") or [],
        "index": index_view,
        "tasks": rendered,
    }
