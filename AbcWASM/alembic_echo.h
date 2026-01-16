#ifndef ALEMBIC_ECHO_H
#define ALEMBIC_ECHO_H

#include <string>
#include <vector>
#include <cstdint>

// Function to read and return the structure of an Alembic file as a string from filename
std::string read_alembic_structure(const std::string& filename);

// Function to read and return the structure of an Alembic file as a string from memory buffer
std::string read_alembic_structure_from_memory(const std::vector<std::uint8_t>& buffer);

#endif // ALEMBIC_ECHO_H