const {DataTypes} = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define(
    "User",{
        id:{
            type:DataTypes.UUID,
            defaultValue:DataTypes.UUIDV4,
            primaryKey:true,
        },
        phone:{
            type:DataTypes.STRING(16),
            allowNull:false,
            unique:true,
        },
        dateOfBirth:{
            type:DataTypes.DATEONLY,
            allowNull:true,
            field:"date_of_birth",
        },
        ageEligible:{
            type:DataTypes.BOOLEAN,
            allowNull:false,
            defaultValue:false,
            field:"age_eligible",
        },
        verificationStatus:{
            type:DataTypes.ENUM(
                "not_started",
                "pending",
                "approved",
                "retry_required",
                "rejected",
                "expired"
            ),
            allowNull:false,
            defaultValue:"not_started",
            field:"verification_status",
        },
        accountStatus:{
            type:DataTypes.ENUM("active","suspended","delete"),
            allowNull:false,
            defaultValue:"active",
            field:"account_status",
        },
    },
    {
        tableName:"users",
        underscored:true,
    },
);

module.exports = User;