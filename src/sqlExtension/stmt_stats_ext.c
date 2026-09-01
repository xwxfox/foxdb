#include "include/sqlite3ext.h"
SQLITE_EXTENSION_INIT1

#include <string.h>
#include <stdlib.h>
#include <stdint.h>

typedef struct Entry {
    char *key;

    int exec_count;

    sqlite3_uint64 fullscan_steps;
    sqlite3_uint64 sort_ops;
    sqlite3_uint64 autoindex;

    struct Entry *next;
} Entry;

static Entry *g_head = NULL;

/* lookup */
static Entry* get_entry(const char *key) {
    Entry *it = g_head;

    while (it) {
        if (strcmp(it->key, key) == 0)
            return it;
        it = it->next;
    }

    Entry *e = (Entry*)sqlite3_malloc(sizeof(Entry));
    if (!e) return NULL;

    memset(e, 0, sizeof(Entry));
    e->key = sqlite3_mprintf("%s", key);

    e->next = g_head;
    g_head = e;

    return e;
}

/* trace */
static int trace_cb(
    unsigned mask,
    void *ctx,
    void *p,
    void *x
){
    if (!(mask & SQLITE_TRACE_STMT))
        return 0;

    sqlite3_stmt *stmt = (sqlite3_stmt*)p;
    const char *sql = sqlite3_sql(stmt);
    if (!sql) return 0;

    Entry *e = get_entry(sql);
    if (!e) return 0;

    e->exec_count++;

    e->fullscan_steps += sqlite3_stmt_status(
        stmt,
        SQLITE_STMTSTATUS_FULLSCAN_STEP,
        0
    );

    e->sort_ops += sqlite3_stmt_status(
        stmt,
        SQLITE_STMTSTATUS_SORT,
        0
    );

    e->autoindex += sqlite3_stmt_status(
        stmt,
        SQLITE_STMTSTATUS_AUTOINDEX,
        0
    );

    return 0;
}

/* export stats */
static void stmt_stats(
    sqlite3_context *ctx,
    int argc,
    sqlite3_value **argv
){
    const char *key = (const char*)sqlite3_value_text(argv[0]);
    if (!key) {
        sqlite3_result_null(ctx);
        return;
    }

    Entry *e = get_entry(key);
    if (!e) {
        sqlite3_result_null(ctx);
        return;
    }

    char *json = sqlite3_mprintf(
        "{"
        "\"sql\":\"%q\","
        "\"exec_count\":%d,"
        "\"cost\":{"
            "\"fullscan_steps\":%llu,"
            "\"sort_ops\":%llu,"
            "\"autoindex\":%llu"
        "}"
        "}",
        e->key,
        e->exec_count,
        e->fullscan_steps,
        e->sort_ops,
        e->autoindex
    );

    sqlite3_result_text(ctx, json, -1, sqlite3_free);
}

/* clear */
static void stmt_stats_clear(
    sqlite3_context *ctx,
    int argc,
    sqlite3_value **argv
){
    Entry *it = g_head;

    while (it) {
        Entry *next = it->next;
        sqlite3_free(it->key);
        sqlite3_free(it);
        it = next;
    }

    g_head = NULL;
    sqlite3_result_null(ctx);
}

/* init */
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_stmtstats_init(
    sqlite3 *db,
    char **err,
    const sqlite3_api_routines *api
){
    SQLITE_EXTENSION_INIT2(api);

    sqlite3_trace_v2(
        db,
        SQLITE_TRACE_STMT,
        trace_cb,
        NULL
    );

    sqlite3_create_function(
        db,
        "stmt_stats",
        1,
        SQLITE_UTF8,
        NULL,
        stmt_stats,
        NULL,
        NULL
    );

    sqlite3_create_function(
        db,
        "stmt_stats_clear",
        0,
        SQLITE_UTF8,
        NULL,
        stmt_stats_clear,
        NULL,
        NULL
    );

    return SQLITE_OK;
}