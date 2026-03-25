#ifndef PHENO_FFI_H
#define PHENO_FFI_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Database Database;

Database* pheno_db_open(const char* path);
void pheno_db_close(Database* db);
void pheno_string_free(char* s);

char* pheno_flag_list(const Database* db);
int pheno_flag_enable(const Database* db, const char* name);
int pheno_flag_disable(const Database* db, const char* name);

char* pheno_config_get(const Database* db, const char* key);
int pheno_config_set(const Database* db, const char* key, const char* value);

int pheno_secret_set(const Database* db, const char* key, const char* plaintext, const char* hex_key);
char* pheno_secret_get(const Database* db, const char* key, const char* hex_key);

char* pheno_version_show(const Database* db);

#ifdef __cplusplus
}
#endif

#endif /* PHENO_FFI_H */
