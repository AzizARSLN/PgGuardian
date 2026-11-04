"""Curated, read-only DBA helper query catalogue.

Design rules:

* Every :class:`QueryDef` is a **single read-only** statement. The toolkit
  itself never mutates server state.
* Remediation lives in :class:`AdviceDef` items, which are either
  *copy-only* SQL snippets (``action="copy"``) or delegate to the
  already-guarded ``/maintenance/*`` and ``/queries/*`` endpoints.
  Nothing runs until the operator explicitly approves it.
* Advice target columns are addressed by *result column name* so the UI can
  pick the right values straight from the row the operator is looking at.
* Tunable literals (row limits, time windows, call thresholds) are *not*
  hard-coded: they are declared as :class:`ParamDef` items and referenced from
  the statement with a ``{name}`` token. :func:`render_sql` substitutes only
  values that were validated against their definition.
"""

from __future__ import annotations

import re
import textwrap
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

ActionKind = Literal[
    "vacuum", "analyze", "reindex", "cancel", "terminate", "drop_index", "copy"
]
RiskKind = Literal["READ", "MAINTENANCE", "DANGEROUS"]
ParamKind = Literal["int", "duration"]


def _sql(text: str) -> str:
    """Normalise a triple-quoted SQL block (dedent + strip)."""
    return textwrap.dedent(text).strip()


@dataclass(frozen=True)
class AdviceDef:
    """An operator-facing recommendation attached to a catalogue query."""

    id: str
    title: str
    description: str
    action: ActionKind
    risk: RiskKind
    sql_preview: str
    target_fields: dict[str, str] = field(default_factory=dict)
    static_body: dict[str, Any] = field(default_factory=dict)
    requires: str = ""


@dataclass(frozen=True)
class ParamDef:
    """An operator-tunable value embedded in a :class:`QueryDef` statement.

    ``kind="int"`` accepts a bounded integer; ``kind="duration"`` accepts one of
    the predefined :attr:`options` (PostgreSQL interval literals). The statement
    carries a ``{name}`` token and :func:`render_sql` replaces it with a value
    that was validated against this definition, so the rendered statement can
    never carry operator-supplied SQL.
    """

    name: str
    label: str
    kind: ParamKind
    default: int | str
    description: str = ""
    minimum: int | None = None
    maximum: int | None = None
    options: tuple[str, ...] = ()
    unit: str = ""


@dataclass(frozen=True)
class QueryDef:
    """One read-only catalogue entry."""

    id: str
    category: str
    title: str
    description: str
    sql: str
    notes: str = ""
    requires_extension: str | None = None
    max_rows: int = 5000
    params: tuple[ParamDef, ...] = ()
    advice: tuple[AdviceDef, ...] = ()


@dataclass(frozen=True)
class CategoryDef:
    """A thematic group of catalogue queries."""

    id: str
    title: str
    description: str
    icon: str


# --------------------------------------------------------------------------- #
# Reusable parameter factories
# --------------------------------------------------------------------------- #


def _limit(default: int = 5000, maximum: int = 5000) -> ParamDef:
    """Row cap applied by the statement's ``LIMIT {limit}`` clause."""
    return ParamDef(
        name="limit",
        label="Satır limiti",
        kind="int",
        default=default,
        minimum=1,
        maximum=maximum,
        unit="satır",
        description="Sorgunun döndüreceği en fazla satır sayısı.",
    )


def _window(default: str, options: tuple[str, ...], description: str) -> ParamDef:
    """Time window used by an ``interval '{window}'`` comparison."""
    return ParamDef(
        name="window",
        label="Zaman penceresi",
        kind="duration",
        default=default,
        options=options,
        description=description,
    )


def _min_calls(default: int = 5) -> ParamDef:
    """Lower bound for a ``calls > {min_calls}`` filter."""
    return ParamDef(
        name="min_calls",
        label="Minimum çağrı sayısı",
        kind="int",
        default=default,
        minimum=0,
        maximum=1000000,
        unit="çağrı",
        description="Yalnızca bu sayıdan fazla çalışmış sorgular listelenir.",
    )


# --------------------------------------------------------------------------- #
# Reusable advice blocks
# --------------------------------------------------------------------------- #

TABLE_TARGET = {"schema_name": "schemaname", "table_name": "tablo"}
INDEX_TARGET = {"schema_name": "schemaname", "index_name": "index_adi"}

ADV_VACUUM = AdviceDef(
    id="vacuum_analyze",
    title="VACUUM (ANALYZE)",
    description=(
        "Ölü satırları geri kazanır ve istatistikleri tazeler. "
        "Tablo üzerinde yalnızca SHARE UPDATE EXCLUSIVE kilidi alır; okuma/yazma devam eder."
    ),
    action="vacuum",
    risk="MAINTENANCE",
    sql_preview="VACUUM (ANALYZE) {schema}.{table}",
    target_fields=TABLE_TARGET,
    static_body={"analyze": True},
)

ADV_VACUUM_FREEZE = AdviceDef(
    id="vacuum_freeze",
    title="VACUUM (FREEZE, ANALYZE)",
    description=(
        "XID yaşlanmasını (wraparound) durdurmak için satırları dondurur. "
        "Büyük tablolarda uzun sürebilir; yoğun saatlerde çalıştırmayın."
    ),
    action="vacuum",
    risk="MAINTENANCE",
    sql_preview="VACUUM (FREEZE, ANALYZE) {schema}.{table}",
    target_fields=TABLE_TARGET,
    static_body={"analyze": True, "freeze": True},
)

ADV_VACUUM_FULL = AdviceDef(
    id="vacuum_full",
    title="VACUUM (FULL, ANALYZE)",
    description=(
        "Tabloyu yeniden yazarak disk alanını geri verir. ACCESS EXCLUSIVE kilidi alır: "
        "tablo tamamen kilitlenir, yeterli boş disk alanı gerekir."
    ),
    action="vacuum",
    risk="DANGEROUS",
    sql_preview="VACUUM (FULL, ANALYZE) {schema}.{table}",
    target_fields=TABLE_TARGET,
    static_body={"analyze": True, "full": True},
)

ADV_ANALYZE = AdviceDef(
    id="analyze",
    title="ANALYZE",
    description="Planner istatistiklerini yeniden toplar; bayat istatistikleri giderir.",
    action="analyze",
    risk="MAINTENANCE",
    sql_preview="ANALYZE {schema}.{table}",
    target_fields=TABLE_TARGET,
)

ADV_REINDEX_CONCURRENTLY = AdviceDef(
    id="reindex_concurrently",
    title="REINDEX INDEX CONCURRENTLY",
    description=(
        "Index'i çevrimiçi yeniden oluşturur (geçersiz/şişmiş indexler için). "
        "Kilit süresini kısaltır ancak daha uzun sürer ve ek disk ister."
    ),
    action="reindex",
    risk="DANGEROUS",
    sql_preview="REINDEX INDEX CONCURRENTLY {schema}.{index}",
    target_fields=INDEX_TARGET,
    static_body={"concurrently": True},
)

ADV_CANCEL_BACKEND = AdviceDef(
    id="cancel_backend",
    title="Sorguyu iptal et (pg_cancel_backend)",
    description="Çalışan sorguyu iptal eder; oturum açık kalır. Kilitlenmeyi çözmek için ilk adım.",
    action="cancel",
    risk="MAINTENANCE",
    sql_preview="SELECT pg_cancel_backend({pid});",
    target_fields={"pid": "pid"},
)

ADV_TERMINATE_BACKEND = AdviceDef(
    id="terminate_backend",
    title="Oturumu sonlandır (pg_terminate_backend)",
    description=(
        "Backend'i zorla kapatır ve tuttuğu kilitleri serbest bırakır. "
        "Uygulama tarafında bağlantı kopmasına yol açar; en son çare olarak kullanın."
    ),
    action="terminate",
    risk="DANGEROUS",
    sql_preview="SELECT pg_terminate_backend({pid});",
    target_fields={"pid": "pid"},
)

ADV_CANCEL_BLOCKER = AdviceDef(
    id="cancel_blocker",
    title="Bloklayan sorguyu iptal et (pg_cancel_backend)",
    description=(
        "Kilit zincirini çözmek için bekleten değil, bloklayan oturumu iptal eder. "
        "Sorgu iptal edilir, oturum açık kalır."
    ),
    action="cancel",
    risk="MAINTENANCE",
    sql_preview="SELECT pg_cancel_backend({pid});",
    target_fields={"pid": "bloklayan_pid"},
)

ADV_TERMINATE_BLOCKER = AdviceDef(
    id="terminate_blocker",
    title="Bloklayan oturumu sonlandır (pg_terminate_backend)",
    description=(
        "Kilit zincirini kesin olarak çözer ancak bloklayan uygulamanın bağlantısını koparır. "
        "En son çare olarak kullanın."
    ),
    action="terminate",
    risk="DANGEROUS",
    sql_preview="SELECT pg_terminate_backend({pid});",
    target_fields={"pid": "bloklayan_pid"},
)

ADV_ALTER_SYSTEM_WAL = AdviceDef(
    id="copy_alter_system_wal",
    title="WAL / checkpoint ayarları önerisi",
    description=(
        "Yoğun checkpoint (checkpoints_req) baskısını azaltmak için tipik ayarlar. "
        "postgresql.conf veya ALTER SYSTEM ile uygulanır; restart/reload sonrası etkin olur."
    ),
    action="copy",
    risk="DANGEROUS",
    sql_preview=_sql(
        """
        ALTER SYSTEM SET checkpoint_timeout = '15min';
        ALTER SYSTEM SET checkpoint_completion_target = 0.9;
        ALTER SYSTEM SET max_wal_size = '4GB';
        ALTER SYSTEM SET min_wal_size = '1GB';
        ALTER SYSTEM SET wal_compression = on;
        -- ardından: SELECT pg_reload_conf();
        """
    ),
    requires="Sunucu RAM'i ve IO kapasitesine göre değerleri doğrulayın.",
)

ADV_WORK_MEM = AdviceDef(
    id="copy_work_mem",
    title="Oturum bazlı work_mem önerisi",
    description=(
        "Global work_mem'i yükseltmek bağlantı başına RAM'i çarpar. Bunun yerine "
        "yalnızca ağır rapor oturumunda geçici olarak yükseltin."
    ),
    action="copy",
    risk="READ",
    sql_preview=_sql(
        """
        SET work_mem = '256MB';                -- yalnız bu oturum
        SET maintenance_work_mem = '1GB';
        SET max_parallel_workers_per_gather = 4;
        """
    ),
)

ADV_DROP_INDEX = AdviceDef(
    id="drop_index",
    title="Index'i kaldır (DROP INDEX CONCURRENTLY)",
    description=(
        "Index'i çevrimiçi (CONCURRENTLY) kaldırır; tablo kilitlenmez ve ek disk alanı "
        "gerekmez. Yinelenen indexin gereksiz kopyasını veya gerçekten kullanılmayan "
        "indexi kaldırın. Bir kısıtı (PK/UNIQUE) destekleyen index bu yöntemle "
        "kaldırılamaz; önce ALTER TABLE ... DROP CONSTRAINT gerekir."
    ),
    action="drop_index",
    risk="DANGEROUS",
    sql_preview="DROP INDEX CONCURRENTLY IF EXISTS {schema}.{index};",
    target_fields=INDEX_TARGET,
)

ADV_ANALYZE_COPY = AdviceDef(
    id="copy_analyze",
    title="ANALYZE önerisi (kopyala)",
    description="Bayat istatistikleri tazelemek için ANALYZE çalıştırın.",
    action="copy",
    risk="MAINTENANCE",
    sql_preview="ANALYZE {schema}.{table};",
    target_fields=TABLE_TARGET,
)


# --------------------------------------------------------------------------- #
# Categories
# --------------------------------------------------------------------------- #

CATEGORIES: tuple[CategoryDef, ...] = (
    CategoryDef(
        id="vacuum",
        title="Vakum & Şişme (Bloat)",
        description="Ölü satır birikimi, vacuum ihtiyacı ve XID yaşlanması.",
        icon="Recycle",
    ),
    CategoryDef(
        id="statistics",
        title="İstatistikler & ANALYZE",
        description="Bayat/eksik planner istatistikleri.",
        icon="ChartColumn",
    ),
    CategoryDef(
        id="indexes",
        title="Index Sağlığı",
        description="Kullanılmayan, yinelenen, geçersiz ve eksik indexler.",
        icon="Database",
    ),
    CategoryDef(
        id="parameters",
        title="Sunucu Parametreleri",
        description="Kritik GUC ayarları ve autovacuum yapılandırması.",
        icon="Settings2",
    ),
    CategoryDef(
        id="statements",
        title="Sorgu İstatistikleri",
        description="pg_stat_statements: süre, temp, disk okuma dağılımı.",
        icon="ListOrdered",
    ),
    CategoryDef(
        id="memory",
        title="Bellek, Temp & I/O",
        description="work_mem, temp dosyaları ve önbellek isabet oranı.",
        icon="HardDrive",
    ),
    CategoryDef(
        id="checkpoints",
        title="Checkpoint & WAL",
        description="bgwriter, checkpoint baskısı, WAL ve arşivleme.",
        icon="Save",
    ),
    CategoryDef(
        id="connections",
        title="Bağlantı Yönetimi",
        description="Bağlantı dağılımı, limit kullanımı ve boşta oturumlar.",
        icon="Users",
    ),
    CategoryDef(
        id="locks",
        title="Kilitler & Transaction'lar",
        description="Blokaj zincirleri, uzun transaction'lar ve deadlock'lar.",
        icon="Lock",
    ),
    CategoryDef(
        id="jobs",
        title="Zamanlanmış İşler",
        description="Cron/bakım aktiviteleri ve kurulu eklentiler.",
        icon="Clock",
    ),
    CategoryDef(
        id="database",
        title="Veritabanı Genel Durum",
        description="Boyutlar, sürüm, uptime ve veritabanı başına özet.",
        icon="Activity",
    ),
)


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #

CATALOG: tuple[QueryDef, ...] = (
    # ---------------------------------------------------------------- vacuum
    QueryDef(
        id="vacuum_dead_tuples",
        category="vacuum",
        title="Ölü satır oranı yüksek tablolar",
        description=(
            "Dead tuple sayısı ve oranına göre vacuum gerektiren tablolar "
            "(A.2.1). Oran %20'nin üzerindeyse manuel VACUUM düşünün."
        ),
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   n_live_tup AS canli,
                   n_dead_tup AS olu,
                   ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS olu_yuzde,
                   last_vacuum,
                   last_autovacuum
            FROM pg_stat_user_tables
            WHERE n_dead_tup > 0
            ORDER BY n_dead_tup DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_VACUUM, ADV_VACUUM_FULL, ADV_VACUUM_FREEZE),
    ),
    QueryDef(
        id="vacuum_never_vacuumed",
        category="vacuum",
        title="Hiç vacuum görmemiş tablolar",
        description="Ölü satırı olmasına rağmen ne manuel ne otomatik vacuum almış tablolar.",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   n_live_tup AS canli,
                   n_dead_tup AS olu,
                   n_mod_since_analyze AS analiz_sonrasi_degisim
            FROM pg_stat_user_tables
            WHERE last_vacuum IS NULL
              AND last_autovacuum IS NULL
              AND n_dead_tup > 0
            ORDER BY n_dead_tup DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_VACUUM,),
    ),
    QueryDef(
        id="vacuum_autovacuum_workers",
        category="vacuum",
        title="Çalışan autovacuum worker'ları",
        description="O anda aktif olan autovacuum süreçleri ve ne kadar süredir çalıştıkları.",
        sql=_sql(
            """
            SELECT pid,
                   datname,
                   usename,
                   state,
                   wait_event_type,
                   wait_event,
                   now() - xact_start AS sure,
                   LEFT(query, 160) AS sorgu
            FROM pg_stat_activity
            WHERE backend_type = 'autovacuum worker'
            ORDER BY xact_start
            """
        ),
    ),
    QueryDef(
        id="vacuum_xid_age_databases",
        category="vacuum",
        title="Veritabanı XID yaşı (wraparound riski)",
        description=(
            "Transaction ID yaşlanması. age(datfrozenxid) 2 milyar sınıra yaklaşırsa "
            "veritabanı salt-okunur moda girer; erken VACUUM FREEZE gerekir."
        ),
        sql=_sql(
            """
            SELECT datname,
                   age(datfrozenxid) AS xid_yasi,
                   ROUND(100.0 * age(datfrozenxid) / 2000000000, 2) AS wraparound_yuzde,
                   datfrozenxid
            FROM pg_database
            ORDER BY age(datfrozenxid) DESC
            """
        ),
        notes="wraparound_yuzde %75'i geçtiğinde bakım penceresi planlayın.",
    ),
    QueryDef(
        id="vacuum_xid_age_tables",
        category="vacuum",
        title="Tablo bazlı XID yaşı",
        description="Hangi tabloların dondurulmaya (FREEZE) en çok ihtiyacı olduğunu gösterir.",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   age(relfrozenxid) AS xid_yasi,
                   pg_size_pretty(pg_total_relation_size(relid)) AS boyut
            FROM pg_stat_user_tables
            ORDER BY age(relfrozenxid) DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_VACUUM_FREEZE,),
    ),
    # ------------------------------------------------------------ statistics
    QueryDef(
        id="stats_stale",
        category="statistics",
        title="Bayat istatistik (çok değişiklik alan)",
        description=(
            "Son ANALYZE'den bu yana en çok değişen tablolar (A.2.2). "
            "Yüksek n_mod_since_analyze kötü plan demektir."
        ),
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   last_analyze,
                   last_autoanalyze,
                   n_mod_since_analyze AS analiz_sonrasi_degisim,
                   n_live_tup AS canli
            FROM pg_stat_user_tables
            ORDER BY n_mod_since_analyze DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_ANALYZE, ADV_ANALYZE_COPY),
    ),
    QueryDef(
        id="stats_old",
        category="statistics",
        title="Bayat istatistikler (zaman penceresi)",
        description="Son istatistiği seçilen süreden eski olan tablolar (A.2.3).",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   last_analyze,
                   last_autoanalyze,
                   GREATEST(COALESCE(last_analyze, '1970-01-01'),
                            COALESCE(last_autoanalyze, '1970-01-01')) AS son_istatistik
            FROM pg_stat_user_tables
            WHERE GREATEST(COALESCE(last_analyze, '1970-01-01'),
                           COALESCE(last_autoanalyze, '1970-01-01')) < now() - interval '{window}'
            ORDER BY son_istatistik
            LIMIT {limit}
            """
        ),
        params=(
            _window(
                "1 day",
                ("6 hours", "1 day", "3 days", "7 days"),
                "Son istatistiği bu süreden eski olan tablolar listelenir.",
            ),
            _limit(),
        ),
        advice=(ADV_ANALYZE,),
    ),
    QueryDef(
        id="stats_never_analyzed",
        category="statistics",
        title="Hiç analyze edilmemiş tablolar",
        description="Veri içerdiği halde istatistiği olmayan tablolar; planner tahminleri yanıltıcı olur.",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   n_live_tup AS canli
            FROM pg_stat_user_tables
            WHERE last_analyze IS NULL
              AND last_autoanalyze IS NULL
              AND n_live_tup > 0
            ORDER BY n_live_tup DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_ANALYZE,),
    ),
    # --------------------------------------------------------------- indexes
    QueryDef(
        id="index_unused",
        category="indexes",
        title="Hiç kullanılmamış (gereksiz) indexler",
        description=(
            "idx_scan = 0 olan indexler, kapladıkları disk alanına göre sıralanır. "
            "İstatistikler yeni sıfırlanmış olabilir; kaldırmadan önce temsili bir iş "
            "yükü penceresinde doğrulayın."
        ),
        sql=_sql(
            """
            SELECT n.nspname AS schemaname,
                   t.relname AS tablo,
                   c.relname AS index_adi,
                   COALESCE(s.idx_scan, 0) AS tarama,
                   pg_size_pretty(pg_relation_size(i.indexrelid)) AS boyut
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace tn ON tn.oid = t.relnamespace
            LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
            LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
            WHERE i.indisvalid
              AND con.oid IS NULL
              AND t.relkind IN ('r', 'p', 'm')
              AND COALESCE(s.idx_scan, 0) = 0
              AND tn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            ORDER BY pg_relation_size(i.indexrelid) DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        notes=(
            "Kısıtı (PK/UNIQUE) destekleyen indexler listelenmez: bunlar DROP INDEX ile "
            "kaldırılamaz. Yabancı anahtarın ihtiyaç duyduğu index'ler de burada görünebilir; "
            "kaldırmadan önce bağımlılıkları kontrol edin."
        ),
        advice=(ADV_DROP_INDEX,),
    ),
    QueryDef(
        id="index_duplicate",
        category="indexes",
        title="Yinelenen indexler (aynı kolon bileşimi)",
        description=(
            "Aynı tablo üzerinde birebir aynı tanıma sahip (aynı kolonlar, sıralama, "
            "operatör sınıfı, ifade ve kısmi koşul) birden fazla index. Her index ayrı "
            "satırda listelenir; 'adet' kaç kopya olduğunu, 'tarama' hangisinin "
            "kullanıldığını gösterir. Kullanılmayan kopyayı kaldırın."
        ),
        sql=_sql(
            """
            WITH yinelenen AS (
                SELECT i.indrelid,
                       i.indkey::text AS kolonlar,
                       i.indclass::text AS opclass,
                       i.indoption::text AS siralama,
                       i.indisunique,
                       i.indisprimary,
                       COALESCE(pg_get_expr(i.indexprs, i.indrelid), '') AS ifade,
                       COALESCE(pg_get_expr(i.indpred, i.indrelid), '') AS kosul,
                       count(*) AS adet
                FROM pg_index i
                WHERE i.indisvalid
                GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
                HAVING count(*) > 1
            )
            SELECT n.nspname AS schemaname,
                   t.relname AS tablo,
                   c.relname AS index_adi,
                   y.adet AS adet,
                   COALESCE(s.idx_scan, 0) AS tarama,
                   pg_size_pretty(pg_relation_size(i.indexrelid)) AS boyut,
                   pg_get_indexdef(i.indexrelid) AS tanim
            FROM pg_index i
            JOIN yinelenen y
              ON y.indrelid = i.indrelid
             AND y.kolonlar = i.indkey::text
             AND y.opclass = i.indclass::text
             AND y.siralama = i.indoption::text
             AND y.indisunique = i.indisunique
             AND y.indisprimary = i.indisprimary
             AND y.ifade = COALESCE(pg_get_expr(i.indexprs, i.indrelid), '')
             AND y.kosul = COALESCE(pg_get_expr(i.indpred, i.indrelid), '')
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace tn ON tn.oid = t.relnamespace
            LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
            WHERE i.indisvalid
              AND t.relkind IN ('r', 'p', 'm')
              AND tn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            ORDER BY t.relname,
                     y.adet DESC,
                     COALESCE(s.idx_scan, 0) ASC,
                     pg_relation_size(i.indexrelid) ASC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        notes=(
            "Sıralamada en az kullanılan (tarama = 0) ve en küçük index üstte gelir; "
            "genellikle kaldırılacak kopya budur."
        ),
        advice=(ADV_DROP_INDEX,),
    ),
    QueryDef(
        id="index_invalid",
        category="indexes",
        title="Geçersiz (invalid) indexler",
        description=(
            "Başarısız CREATE INDEX CONCURRENTLY artıkları. Sorgularda kullanılmazlar "
            "ve gereksiz yer kaplarlar."
        ),
        sql=_sql(
            """
            SELECT n.nspname AS schemaname,
                   c.relname AS index_adi,
                   t.relname AS tablo,
                   i.indisvalid AS gecerli,
                   i.indisready AS hazir
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT i.indisvalid OR NOT i.indisready
            ORDER BY n.nspname, c.relname
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_REINDEX_CONCURRENTLY, ADV_DROP_INDEX),
    ),
    QueryDef(
        id="index_largest",
        category="indexes",
        title="En büyük indexler ve tarama sayıları",
        description="Disk tüketimini index'lerin gerçek kullanımıyla karşılaştırın.",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   indexrelname AS index_adi,
                   idx_scan AS tarama,
                   pg_size_pretty(pg_relation_size(indexrelid)) AS boyut
            FROM pg_stat_user_indexes
            ORDER BY pg_relation_size(indexrelid) DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_REINDEX_CONCURRENTLY,),
    ),
    QueryDef(
        id="index_missing_fk",
        category="indexes",
        title="Index'siz foreign key kolonları",
        description=(
            "FK kısıtı olup ön kolonları index'lenmemiş tablolar. "
            "Bu durum üst tablodaki DELETE/UPDATE işlemlerini yavaşlatır."
        ),
        sql=_sql(
            """
            SELECT n.nspname AS schemaname,
                   t.relname AS tablo,
                   c.conname AS kisit,
                   pg_get_constraintdef(c.oid) AS tanim
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE c.contype = 'f'
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_index i
                  WHERE i.indrelid = c.conrelid
                    AND (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] = c.conkey
              )
            ORDER BY n.nspname, t.relname
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
    ),
    # ------------------------------------------------------------ parameters
    QueryDef(
        id="params_critical",
        category="parameters",
        title="Kritik izleme parametreleri",
        description=(
            "Loglama ve tanılama için önerilen ayarlar (C.1). "
            "log_min_duration_statement, log_lock_waits, log_autovacuum_min_duration vb."
        ),
        sql=_sql(
            """
            SELECT name, setting, unit, context
            FROM pg_settings
            WHERE name IN ('log_min_duration_statement', 'log_lock_waits',
                           'log_autovacuum_min_duration', 'log_checkpoints',
                           'track_io_timing', 'work_mem', 'maintenance_work_mem',
                           'shared_buffers', 'effective_cache_size', 'max_wal_size',
                           'checkpoint_timeout', 'checkpoint_completion_target',
                           'max_connections', 'deadlock_timeout')
            ORDER BY name
            """
        ),
        notes="Öneri: log_min_duration_statement=1000, log_lock_waits=on, log_autovacuum_min_duration=0.",
    ),
    QueryDef(
        id="params_memory",
        category="parameters",
        title="Bellek parametreleri",
        description=(
            "shared_buffers sunucu RAM'inin ~%25'i, effective_cache_size ~%50-75'i "
            "olmalıdır. work_mem bağlantı başına çarpılır."
        ),
        sql=_sql(
            """
            SELECT name, setting, unit
            FROM pg_settings
            WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem',
                           'maintenance_work_mem', 'temp_buffers', 'max_connections',
                           'max_parallel_workers_per_gather')
            ORDER BY name
            """
        ),
        advice=(ADV_WORK_MEM,),
    ),
    QueryDef(
        id="params_autovacuum",
        category="parameters",
        title="Autovacuum yapılandırması",
        description="Global autovacuum eşikleri; agresifliği bu değerler belirler.",
        sql=_sql(
            """
            SELECT name, setting, unit
            FROM pg_settings
            WHERE name LIKE 'autovacuum%'
               OR name IN ('vacuum_cost_limit', 'vacuum_cost_delay',
                           'vacuum_cost_page_hit', 'vacuum_cost_page_miss',
                           'vacuum_cost_page_dirty')
            ORDER BY name
            """
        ),
    ),
    QueryDef(
        id="params_table_reloptions",
        category="parameters",
        title="Tablo bazlı özel ayarlar (reloptions)",
        description="autovacuum/fillfactor gibi tablo düzeyinde geçersiz kılınmış ayarlar.",
        sql=_sql(
            """
            SELECT n.nspname AS schemaname,
                   c.relname AS tablo,
                   array_to_string(c.reloptions, ', ') AS reloptions
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND c.reloptions IS NOT NULL
            ORDER BY n.nspname, c.relname
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
    ),
    # ------------------------------------------------------------ statements
    QueryDef(
        id="stmts_top_total_time",
        category="statements",
        title="En çok toplam süre harcayan sorgular",
        description="Index/kod optimizasyonu için birincil hedef liste (C.2).",
        sql=_sql(
            """
            SELECT queryid,
                   calls,
                   ROUND(total_exec_time::numeric, 2) AS toplam_ms,
                   ROUND(mean_exec_time::numeric, 2) AS ort_ms,
                   rows,
                   shared_blks_hit,
                   shared_blks_read,
                   temp_blks_written,
                   LEFT(query, 220) AS sorgu
            FROM pg_stat_statements
            ORDER BY total_exec_time DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        requires_extension="pg_stat_statements",
    ),
    QueryDef(
        id="stmts_top_temp",
        category="statements",
        title="En çok temp dosya üreten sorgular",
        description="work_mem hedefi (B.3): sıralama/hash birleştirmeleri diske taşan sorgular.",
        sql=_sql(
            """
            SELECT queryid,
                   calls,
                   temp_blks_written,
                   temp_blks_read,
                   LEFT(query, 220) AS sorgu
            FROM pg_stat_statements
            ORDER BY temp_blks_written DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        requires_extension="pg_stat_statements",
        advice=(ADV_WORK_MEM,),
    ),
    QueryDef(
        id="stmts_slow_mean",
        category="statements",
        title="En yüksek ortalama süre (minimum çağrı)",
        description="Tekil olarak yavaş sorgular; kullanıcı deneyimini doğrudan etkiler.",
        sql=_sql(
            """
            SELECT queryid,
                   calls,
                   ROUND(mean_exec_time::numeric, 2) AS ort_ms,
                   ROUND(total_exec_time::numeric, 2) AS toplam_ms,
                   rows,
                   LEFT(query, 220) AS sorgu
            FROM pg_stat_statements
            WHERE calls > {min_calls}
            ORDER BY mean_exec_time DESC
            LIMIT {limit}
            """
        ),
        params=(_min_calls(5), _limit()),
        requires_extension="pg_stat_statements",
    ),
    QueryDef(
        id="stmts_top_disk_read",
        category="statements",
        title="En çok diskten okuyan sorgular",
        description="Önbellek isabeti düşük sorgular; index veya shared_buffers sorununa işaret eder.",
        sql=_sql(
            """
            SELECT queryid,
                   calls,
                   shared_blks_read,
                   shared_blks_hit,
                   ROUND(100.0 * shared_blks_hit
                         / NULLIF(shared_blks_hit + shared_blks_read, 0), 1) AS cache_hit_yuzde,
                   LEFT(query, 220) AS sorgu
            FROM pg_stat_statements
            ORDER BY shared_blks_read DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        requires_extension="pg_stat_statements",
    ),
    QueryDef(
        id="stmts_info",
        category="statements",
        title="pg_stat_statements durumu",
        description="İstatistiğin ne zaman sıfırlandığı ve kaç kaydın düşürüldüğü (dealloc).",
        sql=_sql(
            """
            SELECT dealloc, stats_reset
            FROM pg_stat_statements_info
            """
        ),
        requires_extension="pg_stat_statements",
    ),
    # ---------------------------------------------------------------- memory
    QueryDef(
        id="mem_work_mem_advice",
        category="memory",
        title="Bellek / sıralama (temp file) hedefleri",
        description=(
            "Temp dosya zirvesi yüksekse global work_mem'i yükseltmeyin; "
            "sorun çıkaran rapor oturumunda seans bazlı yükseltin (C.3)."
        ),
        sql=_sql(
            """
            SELECT name, setting, unit
            FROM pg_settings
            WHERE name IN ('shared_buffers', 'effective_cache_size',
                           'work_mem', 'maintenance_work_mem')
            ORDER BY name
            """
        ),
        advice=(ADV_WORK_MEM,),
    ),
    QueryDef(
        id="mem_temp_usage",
        category="memory",
        title="Veritabanı başına temp dosya kullanımı",
        description="temp_files / temp_bytes yüksek olan veritabanları sıralama taşması yaşıyor.",
        sql=_sql(
            """
            SELECT datname,
                   temp_files,
                   pg_size_pretty(temp_bytes) AS temp_boyut,
                   xact_commit,
                   xact_rollback
            FROM pg_stat_database
            WHERE temp_files > 0
            ORDER BY temp_bytes DESC
            """
        ),
        advice=(ADV_WORK_MEM,),
    ),
    QueryDef(
        id="mem_cache_hit",
        category="memory",
        title="Veritabanı önbellek isabet oranı",
        description="Cache hit %90'ın altındaysa shared_buffers/effective_cache_size ve index'ler gözden geçirilmeli.",
        sql=_sql(
            """
            SELECT datname,
                   ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_yuzde,
                   blks_read,
                   blks_hit
            FROM pg_stat_database
            WHERE datname IS NOT NULL
            ORDER BY cache_hit_yuzde NULLS LAST
            """
        ),
    ),
    QueryDef(
        id="mem_io_timing",
        category="memory",
        title="I/O ve takip parametreleri",
        description="IO darboğazı ölçümü için track_io_timing açık olmalı (C.1).",
        sql=_sql(
            """
            SELECT name, setting, unit
            FROM pg_settings
            WHERE name IN ('track_io_timing', 'track_wal_io_timing',
                           'track_counts', 'track_activities')
            ORDER BY name
            """
        ),
    ),
    # ----------------------------------------------------------- checkpoints
    QueryDef(
        id="ckpt_bgwriter",
        category="checkpoints",
        title="Checkpoint ve bgwriter istatistikleri",
        description=(
            "checkpoints_req, checkpoints_timed'a göre yüksekse ani checkpoint baskısı var; "
            "max_wal_size artırımı yardımcı olur."
        ),
        sql=_sql(
            """
            SELECT checkpoints_timed,
                   checkpoints_req,
                   checkpoint_write_time,
                   checkpoint_sync_time,
                   buffers_checkpoint,
                   buffers_clean,
                   buffers_backend,
                   stats_reset
            FROM pg_stat_bgwriter
            """
        ),
        notes="PostgreSQL 17+ ile checkpoint kolonları pg_stat_checkpointer görünümüne taşındı.",
        advice=(ADV_ALTER_SYSTEM_WAL,),
    ),
    QueryDef(
        id="ckpt_checkpointer",
        category="checkpoints",
        title="Checkpoint istatistikleri (PG 17+)",
        description="PostgreSQL 17 ve sonrası için checkpoint sayaçları.",
        sql=_sql(
            """
            SELECT num_timed,
                   num_requested,
                   write_time,
                   sync_time,
                   buffers_written,
                   stats_reset
            FROM pg_stat_checkpointer
            """
        ),
        notes="Yalnızca PostgreSQL 17+ sürümlerinde bulunur.",
        advice=(ADV_ALTER_SYSTEM_WAL,),
    ),
    QueryDef(
        id="ckpt_wal_settings",
        category="checkpoints",
        title="WAL ve checkpoint ayarları",
        description="WAL seviyesi, boyutlar, arşivleme ve checkpoint hedefleri.",
        sql=_sql(
            """
            SELECT name, setting, unit
            FROM pg_settings
            WHERE name IN ('wal_level', 'max_wal_size', 'min_wal_size',
                           'wal_compression', 'wal_buffers', 'archive_mode',
                           'archive_command', 'checkpoint_timeout',
                           'checkpoint_completion_target', 'synchronous_commit')
            ORDER BY name
            """
        ),
        advice=(ADV_ALTER_SYSTEM_WAL,),
    ),
    QueryDef(
        id="ckpt_wal_files",
        category="checkpoints",
        title="WAL dizini boyutu",
        description="pg_wal altındaki dosya sayısı ve toplam boyut; WAL birikimi disk doldurur.",
        sql=_sql(
            """
            SELECT count(*) AS wal_dosya,
                   pg_size_pretty(sum(size)) AS toplam_boyut
            FROM pg_ls_waldir()
            """
        ),
        notes="pg_monitor/pg_read_all_stats rolü gerekir.",
    ),
    QueryDef(
        id="ckpt_archiver",
        category="checkpoints",
        title="Arşivleyici durumu",
        description="archive_mode açıkken başarılı/başarısız WAL arşivleme sayıları.",
        sql=_sql(
            """
            SELECT archived_count,
                   failed_count,
                   last_archived_wal,
                   last_archived_time,
                   last_failed_wal,
                   last_failed_time
            FROM pg_stat_archiver
            """
        ),
    ),
    # ----------------------------------------------------------- connections
    QueryDef(
        id="conn_by_application",
        category="connections",
        title="Uygulama başına bağlantı dağılımı",
        description="Hangi uygulama kaç oturum açmış (C.5); aşırı bağlantı kilit baskısını artırır.",
        sql=_sql(
            """
            SELECT application_name,
                   state,
                   count(*) AS adet
            FROM pg_stat_activity
            GROUP BY application_name, state
            ORDER BY adet DESC
            """
        ),
    ),
    QueryDef(
        id="conn_by_state",
        category="connections",
        title="Durum bazında bağlantılar",
        description="active / idle / idle in transaction dağılımı.",
        sql=_sql(
            """
            SELECT COALESCE(state, 'unknown') AS durum,
                   count(*) AS adet
            FROM pg_stat_activity
            GROUP BY state
            ORDER BY adet DESC
            """
        ),
    ),
    QueryDef(
        id="conn_usage",
        category="connections",
        title="Bağlantı limiti kullanımı",
        description="max_connections'a göre kullanım oranı ve durum kırılımı.",
        sql=_sql(
            """
            SELECT (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_baglanti,
                   count(*) AS mevcut,
                   ROUND(100.0 * count(*)
                         / (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'), 1) AS kullanim_yuzde,
                   count(*) FILTER (WHERE state = 'active') AS aktif,
                   count(*) FILTER (WHERE state = 'idle') AS bosta,
                   count(*) FILTER (WHERE state = 'idle in transaction') AS bosta_transaction
            FROM pg_stat_activity
            """
        ),
    ),
    QueryDef(
        id="conn_long_idle",
        category="connections",
        title="Uzun süre boşta bekleyen oturumlar",
        description="Belirlenen süreden uzun süredir idle/idle in transaction olan oturumlar kaynak tutar.",
        sql=_sql(
            """
            SELECT pid,
                   usename,
                   application_name,
                   client_addr,
                   state,
                   now() - state_change AS idle_sure,
                   LEFT(query, 160) AS son_sorgu
            FROM pg_stat_activity
            WHERE state IN ('idle', 'idle in transaction')
              AND now() - state_change > interval '{window}'
            ORDER BY state_change
            LIMIT {limit}
            """
        ),
        params=(
            _window(
                "5 minutes",
                ("1 minute", "5 minutes", "15 minutes", "1 hour"),
                "Bu süreden uzun süredir boşta bekleyen oturumlar listelenir.",
            ),
            _limit(),
        ),
        advice=(ADV_CANCEL_BACKEND, ADV_TERMINATE_BACKEND),
    ),
    QueryDef(
        id="conn_by_user_db",
        category="connections",
        title="Kullanıcı ve veritabanı bazlı bağlantılar",
        description="Hangi kullanıcı hangi veritabanına kaç bağlantı açmış.",
        sql=_sql(
            """
            SELECT usename,
                   datname,
                   count(*) AS adet
            FROM pg_stat_activity
            GROUP BY usename, datname
            ORDER BY adet DESC
            """
        ),
    ),
    # ---------------------------------------------------------------- locks
    QueryDef(
        id="locks_blocking",
        category="locks",
        title="Aktif kilit bekleyenler ve bloklayanlar",
        description="Kilit zinciri (D.2.1): kimin beklediği, kimin blokladığı ve ne kadar süredir.",
        sql=_sql(
            """
            SELECT w.pid AS bekleyen_pid,
                   w.usename AS bekleyen_kullanici,
                   LEFT(w.query, 160) AS bekleyen_sorgu,
                   b.pid AS bloklayan_pid,
                   b.usename AS bloklayan_kullanici,
                   now() - b.xact_start AS bloklayan_transaction_yasi,
                   b.state AS bloklayan_durum
            FROM pg_stat_activity w
            JOIN pg_stat_activity b ON b.pid = ANY(pg_blocking_pids(w.pid))
            WHERE w.wait_event_type = 'Lock'
            ORDER BY bloklayan_transaction_yasi DESC
            """
        ),
        advice=(ADV_CANCEL_BLOCKER, ADV_TERMINATE_BLOCKER),
    ),
    QueryDef(
        id="locks_long_transactions",
        category="locks",
        title="Uzun transaction'lar",
        description="Kilidi tutan adaylar (D.2.2); uzun transaction autovacuum'u da engeller.",
        sql=_sql(
            """
            SELECT pid,
                   usename,
                   application_name,
                   state,
                   now() - xact_start AS transaction_suresi,
                   now() - query_start AS sorgu_suresi,
                   LEFT(query, 160) AS sorgu
            FROM pg_stat_activity
            WHERE xact_start IS NOT NULL
              AND now() - xact_start > interval '{window}'
            ORDER BY xact_start
            """
        ),
        params=(
            _window(
                "1 minute",
                ("30 seconds", "1 minute", "5 minutes", "15 minutes"),
                "Bu süreden uzun süredir açık olan transaction'lar listelenir.",
            ),
        ),
        advice=(ADV_CANCEL_BACKEND, ADV_TERMINATE_BACKEND),
    ),
    QueryDef(
        id="locks_idle_in_transaction",
        category="locks",
        title="idle in transaction oturumlar",
        description="İş yapmadan kilit tutan oturumlar (D.2.3); uygulama hatası belirtisi.",
        sql=_sql(
            """
            SELECT pid,
                   usename,
                   application_name,
                   now() - state_change AS idle_sure,
                   LEFT(query, 160) AS son_sorgu
            FROM pg_stat_activity
            WHERE state = 'idle in transaction'
            ORDER BY state_change
            """
        ),
        advice=(ADV_CANCEL_BACKEND, ADV_TERMINATE_BACKEND),
    ),
    QueryDef(
        id="locks_all",
        category="locks",
        title="Kilit türü dağılımı",
        description="pg_locks üzerinden kilit türü/mod ve verilen-bekleyen dağılımı.",
        sql=_sql(
            """
            SELECT locktype,
                   mode,
                   granted,
                   count(*) AS adet,
                   array_agg(DISTINCT pid) AS pid_listesi
            FROM pg_locks
            GROUP BY locktype, mode, granted
            ORDER BY adet DESC
            """
        ),
    ),
    QueryDef(
        id="locks_deadlocks",
        category="locks",
        title="Deadlock geçmişi",
        description="Veritabanı başına deadlock ve rollback sayıları; sıfırlanmadan bu yana.",
        sql=_sql(
            """
            SELECT datname,
                   deadlocks,
                   xact_rollback,
                   conflicts,
                   stats_reset
            FROM pg_stat_database
            WHERE deadlocks > 0
            ORDER BY deadlocks DESC
            """
        ),
    ),
    QueryDef(
        id="locks_prepared_xacts",
        category="locks",
        title="Hazırlanmış (prepared) transaction'lar",
        description="2PC ile askıda kalan transaction'lar kilit tutmaya devam eder.",
        sql=_sql(
            """
            SELECT gid, prepared, owner, database
            FROM pg_prepared_xacts
            ORDER BY prepared
            """
        ),
    ),
    # ------------------------------------------------------------------ jobs
    QueryDef(
        id="jobs_scheduled",
        category="jobs",
        title="Zamanlanmış işler ve bakım aktiviteleri",
        description="cron, bakım scriptleri, COPY ve autovacuum süreçlerini birlikte gösterir.",
        sql=_sql(
            """
            SELECT datname,
                   usename,
                   application_name,
                   state,
                   now() - xact_start AS sure,
                   LEFT(query, 160) AS sorgu
            FROM pg_stat_activity
            WHERE application_name LIKE '%cron%'
               OR query LIKE '%maintenance%'
               OR query LIKE '%COPY %'
               OR backend_type = 'autovacuum worker'
            ORDER BY xact_start
            """
        ),
    ),
    QueryDef(
        id="jobs_extensions",
        category="jobs",
        title="Kurulu eklentiler",
        description="pg_stat_statements, pg_stat_kcache vb. hangi eklentiler kurulu.",
        sql=_sql(
            """
            SELECT extname, extversion
            FROM pg_extension
            ORDER BY extname
            """
        ),
    ),
    # -------------------------------------------------------------- database
    QueryDef(
        id="db_overview",
        category="database",
        title="Veritabanı başına genel durum",
        description="Boyut, bağlantı sayısı, commit/rollback, cache hit ve deadlock özeti.",
        sql=_sql(
            """
            SELECT datname,
                   numbackends,
                   xact_commit,
                   xact_rollback,
                   ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit,
                   deadlocks,
                   conflicts,
                   temp_files,
                   pg_size_pretty(pg_database_size(datname)) AS boyut
            FROM pg_stat_database
            WHERE datname IS NOT NULL
            ORDER BY pg_database_size(datname) DESC
            """
        ),
    ),
    QueryDef(
        id="db_largest_tables",
        category="database",
        title="En büyük tablolar (tablo/index kırılımı)",
        description="Toplam boyut, tablo ve index boyutları ayrı ayrı.",
        sql=_sql(
            """
            SELECT schemaname,
                   relname AS tablo,
                   pg_size_pretty(pg_total_relation_size(relid)) AS toplam,
                   pg_size_pretty(pg_relation_size(relid)) AS tablo_boyut,
                   pg_size_pretty(pg_indexes_size(relid)) AS index_boyut
            FROM pg_stat_user_tables
            ORDER BY pg_total_relation_size(relid) DESC
            LIMIT {limit}
            """
        ),
        params=(_limit(),),
        advice=(ADV_VACUUM_FULL,),
    ),
    QueryDef(
        id="db_version",
        category="database",
        title="Sunucu sürümü ve uptime",
        description="Sürüm bilgisi, çalışma süresi ve başlangıç zamanı.",
        sql=_sql(
            """
            SELECT version() AS surum,
                   pg_postmaster_start_time() AS baslangic,
                   now() - pg_postmaster_start_time() AS calisma_suresi
            """
        ),
    ),
)


_CATEGORY_INDEX = {category.id: category for category in CATEGORIES}
_QUERY_INDEX = {query.id: query for query in CATALOG}

# ``{name}`` token used by statements to reference a declared parameter.
_TOKEN = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


def get_query(query_id: str) -> QueryDef | None:
    """Return a catalogue query by id, or ``None``."""
    return _QUERY_INDEX.get(query_id)


def resolve_params(
    query: QueryDef, values: dict[str, Any] | None = None
) -> dict[str, str]:
    """Validate operator-supplied values against ``query.params``.

    Returns SQL-safe literals (missing keys fall back to the declared default)
    and raises :class:`ValueError` when a value does not satisfy its definition.
    """
    supplied = values or {}
    resolved: dict[str, str] = {}
    for param in query.params:
        raw = supplied.get(param.name, param.default)
        if param.kind == "int":
            try:
                number = int(str(raw).strip())
            except (TypeError, ValueError) as exc:
                raise ValueError(f"'{param.label}' tam sayı olmalıdır.") from exc
            if param.minimum is not None and number < param.minimum:
                raise ValueError(f"'{param.label}' en az {param.minimum} olmalıdır.")
            if param.maximum is not None and number > param.maximum:
                raise ValueError(f"'{param.label}' en fazla {param.maximum} olabilir.")
            resolved[param.name] = str(number)
        elif param.kind == "duration":  # pragma: no branch - ParamKind is a closed literal
            text = str(raw).strip()
            if text not in param.options:
                allowed = ", ".join(param.options)
                raise ValueError(f"'{param.label}' şu değerlerden biri olmalıdır: {allowed}.")
            resolved[param.name] = text
    return resolved


def render_sql(
    query: QueryDef, values: dict[str, Any] | None = None
) -> tuple[str, dict[str, str]]:
    """Return the runnable statement plus the applied parameter values.

    Only tokens declared by ``query.params`` are substituted, and only with
    values that :func:`resolve_params` validated (bounded integers or one of
    the predefined interval literals), so operator input cannot inject SQL.
    """
    resolved = resolve_params(query, values)
    if not resolved:
        return query.sql, resolved
    sql = _TOKEN.sub(lambda match: resolved.get(match.group(1), match.group(0)), query.sql)
    return sql, resolved


def catalog_payload() -> dict[str, Any]:
    """Full catalogue as a JSON-ready mapping (queries + categories)."""
    counts: dict[str, int] = {}
    for query in CATALOG:
        counts[query.category] = counts.get(query.category, 0) + 1
    categories = []
    for category in CATEGORIES:
        item = asdict(category)
        item["count"] = counts.get(category.id, 0)
        categories.append(item)
    return {
        "categories": categories,
        "queries": [asdict(query) for query in CATALOG],
        "total": len(CATALOG),
    }
