# Claude Code Rules

- **Error Handling:** If a file edit (`str_replace_editor`) fails more than twice, do not keep retrying. Instead, read the file and use `write_file` to overwrite the entire content.
- **Style:** Maintain the existing indentation of the project.
- **CSS:** Always check for unclosed braces before saving.
