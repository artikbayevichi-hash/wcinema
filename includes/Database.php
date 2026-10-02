<?php
// Database connection class

class Database {
    private static $instance = null;
    private $connection;

    private function __construct() {
        try {
            $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ];
            $this->connection = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            die("Database connection failed: " . $e->getMessage());
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection() {
        return $this->connection;
    }

    public function query($sql, $params = []) {
        try {
            $stmt = $this->connection->prepare($sql);
            $stmt->execute($params);
            return $stmt;
        } catch (PDOException $e) {
            $msg = "Database query error: " . $e->getMessage();

            // APP_DEBUG yoqilgan bo'lsa, xatoni va uni chaqirgan joyni ham
            // yozamiz. Aks holda xato "jimgina" qoladi va topib bo'lmaydi
            // (shu tariqda login 302 qaytarib, hech narsa yozmasligi
            // aniqlanmagan edi).
            if (defined('APP_DEBUG') && APP_DEBUG) {
                $trace = array_slice(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 8), 1);
                $frames = [];
                foreach ($trace as $f) {
                    $frames[] = (isset($f['file']) ? basename($f['file']) : '?')
                        . ':' . (isset($f['line']) ? $f['line'] : '?')
                        . ' ' . (isset($f['function']) ? $f['function'] : '');
                }
                $msg .= " | SQL: " . preg_replace('/\s+/', ' ', substr($sql, 0, 300))
                      . " | params=" . json_encode($params)
                      . " | " . implode(' <- ', $frames);
            }

            error_log($msg);
            return false;
        }
    }

    public function fetchAll($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt ? $stmt->fetchAll() : [];
    }

    /**
     * Bitta qator yoki null.
     *
     * MUHIM: PDOStatement::fetch() qator yo'qligida FALSE qaytaradi, xato
     * bo'lganda esa query() null qaytaradi. Ikkalasi ham "yo'q" holati
     * bo'lgani uchun normalize qilib, doim null qaytaramiz - aks holda
     * kodda `=== null` va `!$row` turli natija beradi.
     */
    public function fetchOne($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        if (!$stmt) {
            return null;
        }
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * INSERT INTO $table (cols) VALUES (?, ?, ...)
     *
     * MUHIM: muvaffaqiyatsiz bo'lsa 0 qaytaradi. Avvalgi versiya
     * lastInsertId() ni shartsiz qaytarar edi - ya'ni INSERT muvaffaqiyatsiz
     * bo'lsa ham kod "0 bo'lmagan" ID va xato haqida yo'q bilardi.
     */
    public function insert($table, $data) {
        if (empty($data)) {
            return 0;
        }

        $columns = array_keys($data);
        $sql = "INSERT INTO $table (" . implode(', ', $columns) . ") VALUES ("
             . implode(', ', array_fill(0, count($columns), '?')) . ')';

        $stmt = $this->query($sql, array_values($data));
        if ($stmt === false) {
            return 0;
        }

        return (int) $this->connection->lastInsertId();
    }

    /**
     * UPDATE $table SET col = ? ... WHERE ...
     *
     * MUHIM: avvalgi versiya SET qismida nomli placeholder (:col), WHERE qismida
     * esa pozitsion ro'yxat ishlatardi. PDO::ATTR_EMULATE_PREPARES = false
     * bilan bu aralashma "SQLSTATE[HY093]: Invalid parameter number: mixed named
     * and positional parameters" xatosini berardi VA xatoni yashirib qo'yardi -
     * ya'ni hech qanday yozuv amalga oshmasdi, lekin kod muvaffaqiyat
     * qaytardi. Endi ikkala qism ham pozitsion (?) ishlatadi.
     */
    public function update($table, $data, $where, $whereParams = []) {
        if (empty($data)) {
            return false;
        }

        $set = [];
        foreach (array_keys($data) as $column) {
            $set[] = "$column = ?";
        }
        $setClause = implode(', ', $set);

        // $data qiymatlari + WHERE parametrlari bitta pozitsion ro'yxatga
        // birlashtiriladi, shunda tartib SQL'dagi ? lar bilan mos keladi.
        $params = array_values($data);
        foreach ((array) $whereParams as $p) {
            $params[] = $p;
        }

        return $this->query("UPDATE $table SET $setClause WHERE $where", $params);
    }

    public function delete($table, $where, $params = []) {
        $sql = "DELETE FROM $table WHERE $where";
        return $this->query($sql, $params);
    }

    public function beginTransaction() {
        return $this->connection->beginTransaction();
    }

    public function commit() {
        return $this->connection->commit();
    }

    public function rollback() {
        return $this->connection->rollback();
    }
}
?>
