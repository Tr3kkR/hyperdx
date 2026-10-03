-- ERROR history retries update their window instead of adding another row.
CREATE UNIQUE INDEX alerthistories_error_window_unique
  ON alerthistories(alert, createdAt, state) WHERE state = 'ERROR';
