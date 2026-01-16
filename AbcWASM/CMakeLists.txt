cmake_minimum_required(VERSION 3.14)
project(AbcWASM)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)


# Fetch Alembic library
FetchContent_Declare(
  alembic
  GIT_REPOSITORY https://github.com/alembic/alembic.git
  GIT_TAG        1.8.10   # Use a stable version
)

FetchContent_Declare(
    imath
    GIT_REPOSITORY https://github.com/AcademySoftwareFoundation/Imath.git
    GIT_TAG        main
)

FetchContent_MakeAvailable(imath alembic)

# Create executable for Alembic test
add_executable(test_alembic test_alembic.cpp)

# Link libraries
target_link_libraries(test_alembic Alembic::Alembic Imath::Imath)