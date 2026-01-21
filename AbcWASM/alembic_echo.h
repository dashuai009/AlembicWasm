#ifndef ALEMBIC_ECHO_H
#define ALEMBIC_ECHO_H

#include <string>
#include <vector>
#include <cstdint>


#include <Alembic/Abc/TypedPropertyTraits.h>
#include <Alembic/AbcCoreAbstract/All.h>
#include <Alembic/AbcCoreFactory/All.h>
#include <Alembic/AbcCoreOgawa/All.h>
#include <Alembic/AbcGeom/All.h>
#include <Alembic/Util/All.h>


// Function to read and return the structure of an Alembic file as a string from filename
std::string read_alembic_structure(const std::string& filename);

// Function to read and return the structure of an Alembic file as a string from memory buffer
std::string read_alembic_structure_from_memory(const std::vector<std::uint8_t>& buffer);

// Function returns mesh vertex data as a vector of floats [x1,y1,z1,x2,y2,z2,...]
std::vector<float> get_mesh_vertices(const std::string& filename);

// Function returns a structured representation of the top-level object from memory buffer
std::string get_alembic_top_object_from_memory(const std::vector<std::uint8_t>& buffer);

// Alembic object wrapper class for WASM interface
class AlembicObjectHandle {
private:
    Alembic::Abc::IObject m_object;
    bool m_valid;

public:
    AlembicObjectHandle(const std::vector<std::uint8_t>& buffer);

    std::string getName() const;
    std::string getFullName() const;
    std::string getSchema() const;
    int getNumChildren() const;
    bool isValid() const;
    std::string getChildName(int index) const;
};

#endif // ALEMBIC_ECHO_H